/////////////////////////////////////////////////////////////////
//                                                             //
//  METEOR SCATTER SERVER PLUGIN FOR FM-DX-WEBSERVER (V1.0)    //
//                                                             //
//  by Highpoint                last update: 2026-04-16        //
//                                                             //
//  https://github.com/Highpoint2000/MeteorScatter             //
//                                                             //
/////////////////////////////////////////////////////////////////

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const http    = require('http');
const { URL } = require('url');

// ── Debug logging toggle ───────────────────────────────────────────────────
const DEBUG_LOG = false;

// ── FM-DX-Webserver logging ──────────────────────────────────────────────
let logInfo, logWarn, logError;
try {
    const con = require('./../../server/console');
    logInfo  = (msg) => con.logInfo ('MeteorScatter', msg);
    logWarn  = (msg) => con.logWarn ('MeteorScatter', msg);
    logError = (msg) => con.logError('MeteorScatter', msg);
} catch (e) {
    logInfo  = (msg) => console.log (`[INFO]  [Meteor Scatter] ${msg}`);
    logWarn  = (msg) => console.warn(`[WARN]  [Meteor Scatter] ${msg}`);
    logError = (msg) => console.error(`[ERROR] [Meteor Scatter] ${msg}`);
}

function debugLog(msg) { if (DEBUG_LOG) logInfo(msg); }

// ── plugins_api ────────────────────────────────────────────────────────────
let pluginsApi;
try {
    pluginsApi = require('../../server/plugins_api');
} catch (e) {
    logWarn(`Could not load plugins_api: ${e.message}`);
}

// ── Plugin registration ────────────────────────────────────────────────────
const pluginConfig = {
    name:         'Meteor Scatter',
    version:      '2.1',
    frontEndPath: 'meteorscatter.js',
};
module.exports = { pluginConfig };

// ── Allowed proxy target domains ───────────────────────────────────────────
const PROXY_ALLOWED_DOMAINS = new Set([
    'api.opentopodata.org',
    'api.open-elevation.com',
    'api.fmlist.org',
    'fmscan.org',
]);

// ── Per-domain response size caps ──────────────────────────────────────────
const RESPONSE_SIZE_LIMITS = {
    'default': 10 * 1024 * 1024,   // 10 MB
};

function getResponseSizeLimit(hostname) {
    return RESPONSE_SIZE_LIMITS[hostname] ?? RESPONSE_SIZE_LIMITS['default'];
}

// ── Server-side cache configuration ───────────────────────────────────────
const CACHE_DIR             = path.join(__dirname, 'cache');
const FMDX_CACHE_TTL_MS     = 24 * 60 * 60 * 1000;
const FMDX_GPS_RETRIGGER_KM = 100;

const FMDX_CACHE_FILE       = path.join(CACHE_DIR, 'fmdx_full.json');
const FMDX_CACHE_META_FILE  = path.join(CACHE_DIR, 'fmdx_meta.json');

const ELEV_CACHE_FILE       = path.join(CACHE_DIR, 'elevation_cache.json');

const FMDX_UPSTREAM_URL     = 'https://maps.fmdx.org/api/';
const FMDX_UPSTREAM_TIMEOUT = 60000;

// In-memory FMDX cache
let _fmdxRawData    = null;
let _fmdxFetchedAt  = 0;
let _fmdxFetchedLat = null;
let _fmdxFetchedLon = null;
let _fmdxFetching   = false;
let _fmdxFetchQueue = [];

// In-memory Elevation cache
let _elevCache      = {};
let _elevCacheDirty = false;

// ── tx_search.js patching like AirplaneScatter ─────────────────────────────
let _txSearchPatched = false;
const TX_SEARCH_PATCH_SENTINEL = '// [MeteorScatter] getLocalDb patch applied';

function patchTxSearch() {
    if (_txSearchPatched) return;
    try {
        const txSearchPath = require.resolve('../../server/tx_search');
        const txSearch     = require(txSearchPath);

        if (typeof txSearch.getLocalDb === 'function') {
            logInfo('tx_search.js already exposes getLocalDb() – skipping patch.');
            _txSearchPatched = true;
            return;
        }

        const mod = require.cache[txSearchPath];
        if (!mod) {
            logWarn('tx_search.js not found in module cache – patch skipped.');
            return;
        }

        patchTxSearchFile(txSearchPath);
    } catch (e) {
        logWarn(`Could not patch tx_search.js: ${e.message}`);
    }
}

function patchTxSearchFile(txSearchPath) {
    try {
        const src = fs.readFileSync(txSearchPath, 'utf8');
        if (src.includes(TX_SEARCH_PATCH_SENTINEL)) {
            logInfo('tx_search.js already patched on disk.');
            _txSearchPatched = true;
            return;
        }

        const exportLine = 'module.exports = {';
        if (!src.includes(exportLine)) {
            logWarn('tx_search.js: could not find module.exports block – patch aborted.');
            return;
        }

        const patchedExport = `${TX_SEARCH_PATCH_SENTINEL}\nmodule.exports = {`;
        const getterLine    = `    getLocalDb: () => localDb,`;

        const patched = src.replace(exportLine, `${patchedExport}\n${getterLine}`);
        fs.writeFileSync(txSearchPath, patched, 'utf8');
        logInfo('tx_search.js patched successfully – getLocalDb() added to exports.');
        logInfo('NOTE: The patch takes effect after the next server restart.');
        _txSearchPatched = true;
    } catch (e) {
        logWarn(`Could not write patch to tx_search.js: ${e.message}`);
    }
}

function getCoreDb() {
    try {
        const txSearch = require('../../server/tx_search');
        if (typeof txSearch.getLocalDb === 'function') {
            const db = txSearch.getLocalDb();
            if (db && Object.keys(db).length > 0) {
                debugLog('Using core TX database from tx_search.js RAM.');
                return db;
            }
        }
    } catch (e) {
        debugLog(`getCoreDb failed: ${e.message}`);
    }
    return null;
}

// Like AirplaneScatter: wait a bit for tx_search RAM DB to become available
function waitForCoreDb(timeoutMs = 90000, intervalMs = 2000) {
    return new Promise((resolve) => {
        const db = getCoreDb();
        if (db) return resolve(db);

        const start = Date.now();
        const timer = setInterval(() => {
            const db = getCoreDb();
            if (db) {
                clearInterval(timer);
                logInfo('tx_search.js DB became available – using core RAM.');
                return resolve(db);
            }
            if (Date.now() - start >= timeoutMs) {
                clearInterval(timer);
                logWarn(`tx_search.js DB not available after ${timeoutMs / 1000}s – falling back to upstream fetch.`);
                resolve(null);
            }
        }, intervalMs);
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────
function ensureDir(dir) {
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const R     = 6371;
    const toRad = d => d * Math.PI / 180;
    const dLat  = toRad(lat2 - lat1);
    const dLon  = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Elevation cache management ─────────────────────────────────────────────
function loadElevCache() {
    try {
        ensureDir(CACHE_DIR);
        if (fs.existsSync(ELEV_CACHE_FILE)) {
            _elevCache = JSON.parse(fs.readFileSync(ELEV_CACHE_FILE, 'utf8'));
            logInfo(`Loaded ${Object.keys(_elevCache).length} elevation points from disk cache.`);
        }
    } catch (e) {
        _elevCache = {};
    }
}

function saveElevCache() {
    if (!_elevCacheDirty) return;
    try {
        ensureDir(CACHE_DIR);
        fs.writeFileSync(ELEV_CACHE_FILE, JSON.stringify(_elevCache));
        _elevCacheDirty = false;
        debugLog('Saved elevation cache to disk.');
    } catch (e) {
        logWarn(`Could not save elevation cache: ${e.message}`);
    }
}
setInterval(saveElevCache, 15000);

function fetchHttps(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'MeteorScatter Plugin' } }, (r) => {
            let data = '';
            r.on('data', d => data += d);
            r.on('end',  () => resolve({ status: r.statusCode, data }));
        }).on('error', reject);
    });
}

// Batch elevation fetch with fallback (OpenTopoData -> Open-Elevation)
async function fetchElevationForLocations(locPairs) {
    const results = new Array(locPairs.length);
    const missing = [];

    for (let i = 0; i < locPairs.length; i++) {
        const loc = locPairs[i];
        if (_elevCache[loc] !== undefined) {
            results[i] = { elevation: _elevCache[loc] };
        } else {
            missing.push({ index: i, loc });
        }
    }
    if (missing.length === 0) return results;

    for (let off = 0; off < missing.length; off += 100) {
        const chunk = missing.slice(off, off + 100);
        const chunkLocs = chunk.map(m => m.loc).join('|');
        let success = false;

        // 1) OpenTopoData
        try {
            const url1 = `https://api.opentopodata.org/v1/srtm90m?locations=${encodeURIComponent(chunkLocs)}`;
            const resp = await fetchHttps(url1);
            if (resp.status === 200) {
                const parsed = JSON.parse(resp.data);
                if (parsed && parsed.results && parsed.results.length === chunk.length) {
                    parsed.results.forEach((r, idx) => {
                        const elev = Math.max(0, r.elevation || 0);
                        const origLoc = chunk[idx].loc;
                        const origIdx = chunk[idx].index;
                        _elevCache[origLoc] = elev;
                        _elevCacheDirty = true;
                        results[origIdx] = { elevation: elev };
                    });
                    success = true;
                }
            }
        } catch (e) {
            logWarn(`OpenTopoData elevation fetch error: ${e.message}`);
        }

        // 2) Open-Elevation fallback
        if (!success) {
            try {
                const url2 = `https://api.open-elevation.com/api/v1/lookup?locations=${encodeURIComponent(chunkLocs)}`;
                const resp = await fetchHttps(url2);
                if (resp.status === 200) {
                    const parsed = JSON.parse(resp.data);
                    if (parsed && parsed.results && parsed.results.length === chunk.length) {
                        parsed.results.forEach((r, idx) => {
                            const elev = Math.max(0, r.elevation || 0);
                            const origLoc = chunk[idx].loc;
                            const origIdx = chunk[idx].index;
                            _elevCache[origLoc] = elev;
                            _elevCacheDirty = true;
                            results[origIdx] = { elevation: elev };
                        });
                        success = true;
                    }
                }
            } catch (e) {
                logWarn(`Open-Elevation fetch error: ${e.message}`);
            }
        }

        if (!success) {
            // Do not poison cache; return null elevations for this chunk
            chunk.forEach(m => { results[m.index] = { elevation: null }; });
        }

        // rate limit friendliness
        if (off + 100 < missing.length) {
            await new Promise(r => setTimeout(r, 1100));
        }
    }

    return results;
}

// ── FMDX cache management ──────────────────────────────────────────────────
function isFmdxCacheValid(lat, lon) {
    if (!_fmdxRawData) return false;
    if (Date.now() - _fmdxFetchedAt > FMDX_CACHE_TTL_MS) return false;
    if (_fmdxFetchedLat !== null && _fmdxFetchedLon !== null) {
        if (haversineKm(lat, lon, _fmdxFetchedLat, _fmdxFetchedLon) > FMDX_GPS_RETRIGGER_KM) return false;
    }
    return true;
}

function saveFmdxMeta() {
    try {
        ensureDir(CACHE_DIR);
        fs.writeFileSync(FMDX_CACHE_META_FILE, JSON.stringify({
            fetchedAt:  _fmdxFetchedAt,
            fetchedLat: _fmdxFetchedLat,
            fetchedLon: _fmdxFetchedLon,
        }), 'utf8');
    } catch (_) {}
}

function restoreFmdxCacheFromDisk() {
    try {
        if (!fs.existsSync(FMDX_CACHE_FILE) || !fs.existsSync(FMDX_CACHE_META_FILE)) return;
        const meta = JSON.parse(fs.readFileSync(FMDX_CACHE_META_FILE, 'utf8'));
        if (!meta.fetchedAt) return;
        if (Date.now() - meta.fetchedAt > FMDX_CACHE_TTL_MS) {
            debugLog('FMDX disk cache expired – will re-fetch on first request.');
            return;
        }

        const raw = fs.readFileSync(FMDX_CACHE_FILE, 'utf8');
        _fmdxRawData    = JSON.parse(raw);
        _fmdxFetchedAt  = meta.fetchedAt;
        _fmdxFetchedLat = meta.fetchedLat ?? null;
        _fmdxFetchedLon = meta.fetchedLon ?? null;
        logInfo(`FMDX disk cache restored (fetched ${new Date(_fmdxFetchedAt).toISOString()}).`);
    } catch (e) {
        logWarn(`Could not restore FMDX disk cache: ${e.message}`);
    }
}

function fetchFmdxUpstream(lat, lon) {
    return new Promise((resolve, reject) => {
        const upstreamUrl = `${FMDX_UPSTREAM_URL}?qth=${encodeURIComponent(lat + ',' + lon)}`;
        const req = https.get(upstreamUrl, {
            headers: {
                'User-Agent': 'FM-DX-Webserver MeteorScatter Plugin (Node.js)',
                'Accept':     'application/json',
            },
            timeout: FMDX_UPSTREAM_TIMEOUT,
        }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`Upstream HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data',  c => chunks.push(c));
            res.on('end',   () => resolve(Buffer.concat(chunks).toString('utf8')));
            res.on('error', reject);
        });

        req.on('timeout', () => { req.destroy(); reject(new Error('Upstream timeout')); });
        req.on('error',   reject);
    });
}

// Like AirplaneScatter: try RAM DB first; only fallback to upstream
function ensureFmdxData(lat, lon) {
    return new Promise((resolve, reject) => {
        waitForCoreDb().then(coreDb => {
            if (coreDb) {
                if (!_fmdxRawData) {
                    _fmdxRawData    = coreDb;
                    _fmdxFetchedAt  = Date.now();
                    _fmdxFetchedLat = lat;
                    _fmdxFetchedLon = lon;
                }
                return resolve(coreDb);
            }

            if (isFmdxCacheValid(lat, lon)) return resolve(_fmdxRawData);

            if (_fmdxFetching) {
                _fmdxFetchQueue.push({ resolve, reject });
                return;
            }

            _fmdxFetching = true;
            logInfo('FMDX cache miss – fetching from upstream...');

            fetchFmdxUpstream(lat, lon)
                .then(rawJson => {
                    const parsed = JSON.parse(rawJson);

                    _fmdxRawData    = parsed;
                    _fmdxFetchedAt  = Date.now();
                    _fmdxFetchedLat = lat;
                    _fmdxFetchedLon = lon;

                    ensureDir(CACHE_DIR);
                    fs.writeFile(FMDX_CACHE_FILE, rawJson, 'utf8', err => {
                        if (err) logWarn(`Could not write FMDX cache: ${err.message}`);
                    });
                    saveFmdxMeta();

                    _fmdxFetching = false;
                    resolve(parsed);
                    _fmdxFetchQueue.forEach(cb => cb.resolve(parsed));
                    _fmdxFetchQueue = [];
                })
                .catch(err => {
                    _fmdxFetching = false;
                    logError(`FMDX upstream fetch failed: ${err.message}`);

                    if (_fmdxRawData) {
                        resolve(_fmdxRawData);
                        _fmdxFetchQueue.forEach(cb => cb.resolve(_fmdxRawData));
                    } else {
                        reject(err);
                        _fmdxFetchQueue.forEach(cb => cb.reject(err));
                    }
                    _fmdxFetchQueue = [];
                });
        });
    });
}

async function filterStationsAsync(rawDb, lat, lon, radiusKm, minErpKw) {
    const locs     = rawDb.locations || rawDb;
    const latDelta = radiusKm / 111.0;
    const lonDelta = radiusKm / Math.max(0.1, Math.abs(111.0 * Math.cos(lat * Math.PI / 180)));
    const stations = [];

    const keys = Object.keys(locs);
    let lastYield = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    for (let i = 0; i < keys.length; i++) {
        if (typeof performance !== 'undefined' && performance.now) {
            if (performance.now() - lastYield > 5) {
                await new Promise(resolve => setImmediate(resolve));
                lastYield = performance.now();
            }
        }

        const loc = locs[keys[i]];
        if (!loc || !Array.isArray(loc.stations)) continue;

        const locLat = parseFloat(loc.lat);
        const locLon = parseFloat(loc.lon);

        if (Math.abs(locLat - lat) > latDelta || Math.abs(locLon - lon) > lonDelta) continue;

        const dist = haversineKm(lat, lon, locLat, locLon);
        if (dist > radiusKm) continue;

        for (const st of loc.stations) {
            const fMHz = parseFloat(st.freq);
            const erp  = parseFloat(st.erp);
            if (fMHz < 87.5 || fMHz > 108.0 || isNaN(erp) || erp < minErpKw) continue;

            stations.push({
                id:       st.id,
                freq:     fMHz,
                city:     loc.name    || '',
                itu:      loc.itu     || '',
                erp,
                lat:      locLat,
                lon:      locLon,
                dist:     Math.round(dist),
                terrainM: 0, // filled below best-effort
                station:  st.station  || '',
                ps:       st.ps       || '',
                pol:      st.pol      || '',
            });
        }
    }

    // Enrich TX terrainM: query unique TX points from elevation cache
    const uniqueLocs = [];
    const seen = new Set();
    for (const tx of stations) {
        const locKey = `${tx.lat.toFixed(4)},${tx.lon.toFixed(4)}`;
        if (seen.has(locKey)) continue;
        seen.add(locKey);
        if (_elevCache[locKey] === undefined) uniqueLocs.push(locKey);
    }

    if (uniqueLocs.length > 0) {
        await fetchElevationForLocations(uniqueLocs);
    }

    for (const tx of stations) {
        const locKey = `${tx.lat.toFixed(4)},${tx.lon.toFixed(4)}`;
        const e = _elevCache[locKey];
        if (typeof e === 'number') tx.terrainM = e;
    }

    return stations;
}

// ── Prevent FM-DX-Webserver early 404 ─────────────────────────────────────
function sealResponse(res) {
    const _setHeader = res.setHeader.bind(res);
    const _writeHead = res.writeHead.bind(res);
    const _write     = res.write.bind(res);
    const _end       = res.end.bind(res);

    res.setHeader = () => {};
    res.writeHead = () => {};
    res.write     = () => {};
    res.end       = () => {};

    return { _setHeader, _writeHead, _write, _end };
}

// ── Handlers ──────────────────────────────────────────────────────────────
async function handleFmdxRequest(req, res) {
    const { _setHeader, _writeHead, _end } = sealResponse(res);

    try {
        const reqUrl   = new URL(req.url, `http://${req.headers.host}`);
        const qth      = reqUrl.searchParams.get('qth') || '';

        const radiusKm = Math.min(2500, Math.max(50, parseFloat(reqUrl.searchParams.get('radius')) || 2200));
        const minErpKw = Math.max(0,    parseFloat(reqUrl.searchParams.get('erp'))    || 20);

        const [latStr, lonStr] = qth.split(',');
        const lat = parseFloat(latStr);
        const lon = parseFloat(lonStr);

        if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            _writeHead(400, { 'Content-Type': 'text/plain' });
            _end('Invalid or missing qth parameter');
            return;
        }

        const rawDb    = await ensureFmdxData(lat, lon);
        const stations = await filterStationsAsync(rawDb, lat, lon, radiusKm, minErpKw);

        _setHeader('Access-Control-Allow-Origin', '*');
        _setHeader('Content-Type', 'application/json; charset=utf-8');
        _setHeader('Cache-Control', 'no-store');
        _writeHead(200);
        _end(JSON.stringify(stations));

    } catch (err) {
        logError(`FMDX endpoint error: ${err.message}`);
        try { _writeHead(502, { 'Content-Type': 'text/plain' }); } catch (_) {}
        try { _end(`Upstream error: ${err.message}`); } catch (_) {}
    }
}

async function handleElevationRequest(req, res) {
    const { _setHeader, _writeHead, _end } = sealResponse(res);

    try {
        const reqUrl = new URL(req.url, `http://${req.headers.host}`);
        const locsParam = reqUrl.searchParams.get('locations');
        if (!locsParam) { _writeHead(400); _end('Missing locations parameter'); return; }

        const locPairs = locsParam.split('|').slice(0, 500); // safety cap
        const results = await fetchElevationForLocations(locPairs);

        _setHeader('Access-Control-Allow-Origin', '*');
        _setHeader('Content-Type', 'application/json; charset=utf-8');
        _setHeader('Cache-Control', 'no-store');
        _writeHead(200);
        _end(JSON.stringify({ results }));

    } catch (err) {
        logError(`Elevation endpoint error: ${err.message}`);
        try { _writeHead(500); _end('Server Error'); } catch (_) {}
    }
}

function handleProxy(req, res) {
    const { _setHeader, _writeHead, _write, _end } = sealResponse(res);

    const targetUrlStr = new URL(req.url, `http://${req.headers.host}`).searchParams.get('url');
    if (!targetUrlStr) { _writeHead(400); return _end('Missing url'); }

    let targetUrl;
    try { targetUrl = new URL(targetUrlStr); }
    catch (_) { _writeHead(400); return _end('Invalid url'); }

    if (!PROXY_ALLOWED_DOMAINS.has(targetUrl.hostname)) { _writeHead(403); return _end('Forbidden domain'); }

    const client = targetUrl.protocol === 'https:' ? https : http;
    const options = {
        hostname: targetUrl.hostname,
        port:     targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path:     targetUrl.pathname + targetUrl.search,
        method:   'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer':    'https://fmscan.org/',
            'Cookie':     'cookieConsent=true; FMSCAN=ba5f492c037ed4faadd6c6235f57797a; FMLISTFMSCAN=1kihEisqpMz6mkNaJLlw02OWiN6xZGIQqryvQgb5tQ2W0FwAQXwHQBdyPZmogv5N%7Cjens.burkert%40gmx.de%7C28788318343'
        },
        timeout: 10000
    };

    let responded = false;
    let bytesReceived = 0;
    const MAX_RESPONSE_BYTES = getResponseSizeLimit(targetUrl.hostname);

    const proxyReq = client.request(options, (proxyRes) => {
        if (responded) { proxyRes.resume(); return; }
        responded = true;
        _setHeader('Access-Control-Allow-Origin', '*');
        if (proxyRes.headers['content-type']) {
            _setHeader('Content-Type', proxyRes.headers['content-type']);
        }
        _writeHead(proxyRes.statusCode);

        proxyRes.on('data', chunk => {
            bytesReceived += chunk.length;
            if (bytesReceived > MAX_RESPONSE_BYTES) {
                proxyReq.destroy();
                _end();
                return;
            }
            _write(chunk);
        });
        proxyRes.on('end', () => _end());
        proxyRes.on('error', () => _end());
    });

    proxyReq.on('timeout', () => { if(!responded) { _writeHead(504); _end('Gateway Timeout'); } proxyReq.destroy(); });
    proxyReq.on('error', (e) => { if (!responded) { _writeHead(502); _end(`Proxy error: ${e.message}`); } });
    proxyReq.end();
}

// ── File deployment & Watching ─────────────────────────────────────────────
const FILES_TO_SYNC = ['meteorscatter.js', 'blacklist.txt', 'whitelist.txt'];
const PUBLIC_DIRS = [
    path.join(__dirname, '..', '..', 'public', 'plugins', 'MeteorScatter'),
    path.join(__dirname, '..', '..', 'web',    'plugins', 'MeteorScatter'),
];

function syncFileToPublic(fileName) {
    const srcPath = path.join(__dirname, fileName);
    PUBLIC_DIRS.forEach(destDir => {
        ensureDir(destDir);
        const destPath = path.join(destDir, fileName);
        try {
            if (fs.existsSync(srcPath)) {
                fs.copyFileSync(srcPath, destPath);
                debugLog(`Synced ${fileName} → ${destDir}`);
            } else if (!fs.existsSync(destPath)) {
                fs.writeFileSync(destPath, '');
            }
        } catch (err) {
            logError(`Failed to sync ${fileName} to ${destDir}: ${err.message}`);
        }
    });
}

function syncAllFilesToPublic() {
    FILES_TO_SYNC.forEach(fileName => syncFileToPublic(fileName));
}

const _fileWatchers   = {};
const _debounceTimers = {};

function setupFileWatcher(fileName) {
    const srcPath = path.join(__dirname, fileName);
    if (_fileWatchers[fileName]) {
        try { _fileWatchers[fileName].close(); } catch (_) {}
        delete _fileWatchers[fileName];
    }
    if (!fs.existsSync(srcPath)) return;
    try {
        _fileWatchers[fileName] = fs.watch(srcPath, { persistent: false }, (eventType) => {
            if (eventType !== 'change') return;
            if (_debounceTimers[fileName]) clearTimeout(_debounceTimers[fileName]);
            _debounceTimers[fileName] = setTimeout(() => {
                logInfo(`Change detected in ${fileName} – syncing...`);
                if (_fileWatchers[fileName]) {
                    try { _fileWatchers[fileName].close(); } catch (_) {}
                    delete _fileWatchers[fileName];
                }
                syncFileToPublic(fileName);
                setTimeout(() => setupFileWatcher(fileName), 1000);
            }, 500);
        });
    } catch (err) {
        logError(`Could not set up watcher for ${fileName}: ${err.message}`);
    }
}

function setupAllFileWatchers() {
    FILES_TO_SYNC.forEach(fileName => setupFileWatcher(fileName));
}


// ── Init ──────────────────────────────────────────────────────────────────
function init() {
    logInfo('Initializing MeteorScatter server plugin...');

    patchTxSearch();
    restoreFmdxCacheFromDisk();
    loadElevCache();
    
    syncAllFilesToPublic();
    setupAllFileWatchers();

    if (!pluginsApi) {
        logWarn('pluginsApi not found. Endpoints cannot be started.');
        return;
    }
    const server = pluginsApi.getHttpServer();
    if (!server) {
        logWarn('pluginsApi.getHttpServer() returned null.');
        return;
    }

    server.prependListener('request', (req, res) => {
        if (!req.url) return;

        if (req.url.startsWith('/api/meteorscatter/fmdx')) {
            handleFmdxRequest(req, res);
        } else if (req.url.startsWith('/api/meteorscatter/elevation')) {
            handleElevationRequest(req, res);
        } else if (req.url.startsWith('/api/meteorscatter/proxy')) {
            handleProxy(req, res);
        }
    });

    logInfo('Endpoints /fmdx, /elevation and /proxy attached to HTTP server.');
}

setTimeout(init, 500);