/////////////////////////////////////////////////////////////////
//                                                             //
//  METEOR SCATTER CLIENT PLUGIN FOR FM-DX-WEBSERVER (V1.0)    //
//                                                             //
//  by Highpoint                last update: 2026-04-16        //
//                                                             //
//  https://github.com/Highpoint2000/MeteorScatter             //
//                                                             //
/////////////////////////////////////////////////////////////////

(() => {
    const pluginVersion = "1.0";
    const pluginName    = "Meteor Scatter";
    const pluginHomepageUrl = "https://github.com/Highpoint2000/MeteorScatter/releases";
    const pluginUpdateUrl   = "https://raw.githubusercontent.com/Highpoint2000/MeteorScatter/refs/heads/main/MeteorScatter/meteorscatter.js";
    const CHECK_FOR_UPDATES = true;

    function _checkUpdate() {
        fetch(pluginUpdateUrl + "?t=" + Date.now(), { cache: "no-store" })
            .then(r => r.ok ? r.text() : null)
            .then(txt => {
                if (!txt) return;
                const m = txt.match(/(?:const|let|var)\s+pluginVersion\s*=\s*["']([^"']+)["']/);
                if (!m) return;
                const remote = m[1];
                if (remote === pluginVersion) return;
                console.log(`[${pluginName}] Update available: ${pluginVersion} → ${remote}`);

                const settings = document.getElementById("plugin-settings");
                if (settings && settings.innerHTML.indexOf(pluginHomepageUrl) === -1) {
                    settings.innerHTML += `<br><a href='${pluginHomepageUrl}' target='_blank'>[${pluginName}] Update: ${pluginVersion} → ${remote}</a>`;
                }

                const icon =
                    document.querySelector(".wrapper-outer #navigation .sidenav-content .fa-meteor")?.closest('a') ||
                    document.querySelector(".wrapper-outer #navigation .sidenav-content .fa-puzzle-piece")?.closest('a') ||
                    document.querySelector(".wrapper-outer .sidenav-content") ||
                    document.querySelector(".sidenav-content");
                if (icon && !icon.querySelector(`.${pluginName.replace(/\s+/g, '')}-update-dot`)) {
                    const dot = document.createElement("span");
                    dot.className = `${pluginName.replace(/\s+/g, '')}-update-dot`;
                    dot.style.cssText =
                        "display:block;width:12px;height:12px;border-radius:50%;" +
                        "background-color:#FE0830;margin-left:82px;margin-top:-12px;";
                    icon.appendChild(dot);
                }
            })
            .catch(e => {
                console.warn(`[${pluginName}] Update check failed:`, e);
            });
    }
    if (CHECK_FOR_UPDATES) _checkUpdate();

    const currentUrl = new URL(window.location.href);
    const basePath = currentUrl.origin + currentUrl.pathname
        .replace(/\/setup\/?$/, '/')
        .replace(/\/$/, '');

    const ELEVATION_API_LOCAL = basePath + '/api/meteorscatter/elevation?locations=';
    const FMDX_API_ENDPOINT   = basePath + '/api/meteorscatter/fmdx';

    const PI_180 = Math.PI / 180;

    // ── Major meteor showers (ZHR) ─────────────────────────────────────────
    const METEOR_SHOWERS = [
        { id: "quadrantids",   name: "Quadrantids",   start: [1, 1],  end: [1, 5],  peak: [1, 3],  ra: 230, dec: 49,  zhr: 110 },
        { id: "lyrids",        name: "Lyrids",        start: [4, 16], end: [4, 25], peak: [4, 22], ra: 271, dec: 34,  zhr: 18  },
        { id: "eta_aquariids", name: "Eta Aquariids", start: [4, 19], end: [5, 28], peak: [5, 6],  ra: 338, dec: -1,  zhr: 50  },
        { id: "perseids",      name: "Perseids",      start: [7, 17], end: [8, 24], peak: [8, 12], ra: 48,  dec: 58,  zhr: 100 },
        { id: "orionids",      name: "Orionids",      start: [10, 2], end: [11, 7], peak: [10, 21],ra: 95,  dec: 16,  zhr: 20  },
        { id: "leonids",       name: "Leonids",       start: [11, 6], end: [11, 30],peak: [11, 17],ra: 152, dec: 22,  zhr: 15  },
        { id: "geminids",      name: "Geminids",      start: [12, 4], end: [12, 17],peak: [12, 14],ra: 112, dec: 33,  zhr: 120 },
    ];

    // ── Settings ───────────────────────────────────────────────────────────
    function getInt(val, def) {
        if (val === null || val === undefined) return def;
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? def : parsed;
    }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function loadSettings() {
        return {
            minDistKm: getInt(localStorage.getItem('ms_min_dist'), 700),
            maxDistKm: getInt(localStorage.getItem('ms_max_dist'), 2200),
            minErpKw:  getInt(localStorage.getItem('ms_min_erp'), 100),

            minScore:  getInt(localStorage.getItem('ms_min_score'), 50),

            targetTopN: getInt(localStorage.getItem('ms_target_topn'), 60),
            mapTopN:    getInt(localStorage.getItem('ms_map_topn'), 120),

            sunWeighting:   getInt(localStorage.getItem('ms_sun_weighting'), 1), // 0/1
            strictMinScore: getInt(localStorage.getItem('ms_strict_minscore'), 0), // 0/1
            
            filterMode:     localStorage.getItem('ms_filter_mode') || 'none',

            rxAglM: getInt(localStorage.getItem('ms_rx_agl_m'), 10),
            txAglM: getInt(localStorage.getItem('ms_tx_agl_m'), 150),
            pathPoints: getInt(localStorage.getItem('ms_path_pts'), 75),

            meteorModel: localStorage.getItem('ms_meteor_model') || 'single', // 'single' | 'multi'
            meteorAltKm: getInt(localStorage.getItem('ms_meteor_alt_km'), 95),

            groupCollapse: getInt(localStorage.getItem('ms_group_collapse'), 1), // default to 1 (collapsed)

            useMetric: localStorage.getItem('ms_use_metric') !== 'false',
            autoRightAlign: localStorage.getItem('ms_auto_right_align') === 'true',
        };
    }

    let S = loadSettings();

    // ── UI state ──────────────────────────────────────────────────────────
    let mapActive = false, mapInstance = null;
    let lineLayer = null, txLayer = null, hotspotLayer = null, rxMarker = null, radiantLayer = null;
    let rotorLayer = null;
    let wrapper = null, mapContainer = null;

    let txStations = [];
    let gpsLat = null, gpsLon = null;

    let _selectedShowerId = 'auto';
    let currentCands = [];
    let currentRx = null;
    let currentRadiantAz = null;
    let currentRadiantAlt = null;
    let focusedCand = null;

    let rxTerrainM = null;
    let _elevCache = {};
    let _pathElevCache = {};

    let rotorAzDeg = null;
    let ws = null;
    const clientId = Math.random().toString(36).substring(2);
    let ipAddress = null;
    let isAdminLoggedIn = false;
    let isTuneLoggedIn = false;
    let isLockAuthenticated = true;

    let _activeProfileTxKey = null;
    let _activeProfileTxObj = null;
    let _currentPathElevs = null;
    let _currentProfileDist = 0;
    let profMinX = 0;
    let profMaxX = 0;
    let isDraggingProf = false;
    let lastMouseX = 0;
    let profScaleY = 1.0;

    // ── Utility Functions ───────────────────────────────────────────────
    function fmtDist(km) {
        if (S.useMetric) return Math.round(km) + ' km';
        return Math.round(km * 0.621371) + ' mi';
    }
    function fmtAlt(m) {
        if (S.useMetric) return Math.round(m) + ' m';
        return Math.round(m * 3.28084) + ' ft';
    }

    function applyRightAlign(active) {
        if (active && S.autoRightAlign) {
            document.body.classList.add("align-right");
            if (!document.getElementById('ms-rightalign-style')) {
                const styleEl = document.createElement('style');
                styleEl.id = 'ms-rightalign-style';
                styleEl.innerHTML = `
                    body.align-right .wrapper-outer.dashboard-panel { justify-content: center !important; align-items: flex-end !important; padding-right: 10px !important; }
                    body.align-right .wrapper-outer.main-content { justify-content: center !important; align-items: flex-end !important; padding-right: 3px !important; }
                    body.align-right #wrapper { margin-right: 0px !important; }
                    body.align-right #dashboard-panel-description { margin-left: auto !important; margin-right: 10px !important; left: auto !important; right: 0 !important; }
                `;
                document.head.appendChild(styleEl);
            }
            const desc = document.getElementById("dashboard-panel-description");
            if (desc) {
                desc.style.left = "auto"; desc.style.right = "0";
                desc.style.transform = "translateX(-3px)";
                desc.style.marginLeft = "0"; desc.style.marginRight = "0";
            }
        } else {
            document.body.classList.remove("align-right");
            const desc = document.getElementById("dashboard-panel-description");
            if (desc) {
                desc.style.left = ""; desc.style.right = "";
                desc.style.transform = "";
                desc.style.marginLeft = ""; desc.style.marginRight = "";
            }
        }
    }

    // ── Data loading ─────────────────────────────────────────────────────
    const COUNTRY_LIST_URL = 'https://tef.noobish.eu/logos/scripts/js/countryList.js';
    const COUNTRY_CACHE_KEY = 'ms_CountryList';
    const COUNTRY_CACHE_TIME_KEY = 'ms_CountryListTime';
    const COUNTRY_CACHE_TTL = 24 * 60 * 60 * 1000;

    let ituToFlag = {};
    const _flagHtmlCache = {};

    async function loadCountryLookup() {
        try {
            const raw = localStorage.getItem(COUNTRY_CACHE_KEY);
            const ts  = parseInt(localStorage.getItem(COUNTRY_CACHE_TIME_KEY) || '0', 10);
            if (raw && (Date.now() - ts < COUNTRY_CACHE_TTL)) {
                const parsed = JSON.parse(raw);
                if (Object.keys(parsed).length > 0) return parsed;
            }
        } catch (e) {}

        try {
            const res = await fetch(COUNTRY_LIST_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(`Country list fetch failed (${res.status})`);
            const jsText = await res.text();

            let countryList = [];
            countryList = (new Function(`${jsText}; return countryList;`))();

            const lookup = {};
            countryList.forEach(({ itu_code, country_code }) => {
                if (itu_code && country_code) lookup[itu_code.toUpperCase()] = country_code.toLowerCase();
            });

            localStorage.setItem(COUNTRY_CACHE_KEY, JSON.stringify(lookup));
            localStorage.setItem(COUNTRY_CACHE_TIME_KEY, Date.now().toString());

            return lookup;
        } catch(e) {
            console.warn(`[${pluginName}] Failed to load country list:`, e);
            return {};
        }
    }

    function getFlagImg(itu, w=16, h=12) {
        if (!ituToFlag || !itu) return '';
        const key = itu.toUpperCase() + '_' + w + '_' + h;
        if (_flagHtmlCache[key] !== undefined) return _flagHtmlCache[key];
        const flagCode = ituToFlag[itu.toUpperCase()];
        if (!flagCode || flagCode === 'xx') { _flagHtmlCache[key] = ''; return ''; }
        const html = `<img src="https://flagcdn.com/24x18/${flagCode}.png" style="vertical-align:middle; width:${w}px; height:${h}px; border-radius:2px; box-shadow:0 0 2px rgba(0,0,0,0.5);" alt="${itu}">`;
        _flagHtmlCache[key] = html;
        return html;
    }

    // ── Frequency Filter List (Whitelist/Blacklist) ────────────────────────
    async function fetchFrequencyList(mode) {
        if (mode === 'none') return new Set();
        const fileName = mode === 'blacklist' ? 'blacklist.txt' : 'whitelist.txt';
        const url = `${currentUrl.protocol}//${currentUrl.host}/plugins/MeteorScatter/${fileName}?t=${Date.now()}`;
        try {
            const res = await fetch(url);
            if (!res.ok) return new Set();
            const text = await res.text();
            const freqs = text.split('\n')
                .map(l => l.trim().replace(',', '.').replace(/\s.*$/, ''))
                .filter(l => l !== '' && !l.startsWith('#'))                 
                .map(l => parseFloat(l))
                .filter(f => !isNaN(f) && f >= 87.5 && f <= 108.0);       
            return new Set(freqs.map(f => Math.round(f * 100)));
        } catch(e) { return new Set(); }
    }

    // ── Audio Stream Functions ────────────────────────────────────────────
    let msAudioPlayer = null;
    let msCurrentStreamId = null;

    window._msPlayStream = function(url) {
        if (!msAudioPlayer) {
            msAudioPlayer = document.createElement('audio');
            msAudioPlayer.id = 'ms-livemap-player';
            msAudioPlayer.autoplay = true;
            msAudioPlayer.controls = false;
            msAudioPlayer.style.display = 'none';
            document.body.appendChild(msAudioPlayer);
        }
        msAudioPlayer.src = url;
        msAudioPlayer.play().catch(() => {
            if(typeof sendToast === 'function') sendToast('error', 'Play Stream', 'Audio playback failed', false, false);
        });
    };

    window._msStopStream = function() {
        if (msAudioPlayer) {
            msAudioPlayer.pause(); msAudioPlayer.src = ''; msAudioPlayer.remove(); msAudioPlayer = null;
        }
        document.querySelectorAll('.ms-stream-btn.fa-square').forEach(icon => {
            icon.classList.remove('fa-square'); icon.classList.add('fa-play'); icon.style.color = '#4aaeff';
        });
        msCurrentStreamId = null;
    };

    window._msHandleStreamClick = async function(id, stationName, iconElement) {
        if (msCurrentStreamId === id) { window._msStopStream(); return; }
        window._msStopStream();
        if(typeof sendToast === 'function') sendToast('info', 'Play Stream', `Loading stream for ${stationName}...`, false, false);

        try {
            const API_URL = `https://api.fmlist.org/152/fmdxGetStreamById.php?id=${id}&token=924924`;
            const domain  = window.location.host;
            const proxyUrl = basePath + '/api/meteorscatter/proxy?url=' + encodeURIComponent(`${API_URL}&cb=${Date.now()}&domain=${domain}`);
            const resp = await fetch(proxyUrl);
            if (!resp.ok) throw new Error(`API-Error ${resp.status}`);
            const streams = await resp.json();

            if (!Array.isArray(streams) || streams.length === 0) {
                if(typeof sendToast === 'function') sendToast('warning important', 'Play Stream', 'No stream URL found!', false, false);
                return;
            }

            const best = streams.reduce((a, b) => parseInt(b.bitrate) > parseInt(a.bitrate) ? b : a);
            window._msPlayStream(best.linkname);
            msCurrentStreamId = id;

            if (iconElement) {
                iconElement.classList.remove('fa-play'); iconElement.classList.add('fa-square'); iconElement.style.color = 'white';
            }

            if(typeof sendToast === 'function') sendToast('info important', 'Play Stream',
                `<div style="max-width:150px;white-space:normal;word-break:break-all;">Playing: ${best.linkname}</div>`, false, false);
        } catch (err) {
            if(typeof sendToast === 'function') sendToast('error', 'Play Stream', 'Error loading stream data', false, false);
        }
    };

    // ── Frequency tuning ────────────────────────────────────────────────
    function onFrequencyClick(freqMHz) {
        if(typeof socket !== 'undefined' && socket.readyState === 1) {
            const tuneCmd = `T${Math.round(freqMHz * 1000)}`;
            socket.send(tuneCmd);
        } else {
            console.warn(`[${pluginName}] Cannot tune to ${freqMHz} MHz, WebSocket not connected.`);
            if(typeof sendToast === 'function') sendToast('error', 'Tune', `Cannot tune, WebSocket not connected.`, false, false);
        }
    }

    // ── WebSocket (DataPlugins + Rotor) ───────────────────────────────────
    async function fetchIpAddress() {
        const host = currentUrl.hostname;
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return host;
        try {
            const dnsRes  = await fetch(`https://dns.google/resolve?name=${host}&type=A`);
            const dnsJson = await dnsRes.json();
            if (dnsJson.Answer && dnsJson.Answer.length) {
                const aRecord = dnsJson.Answer.find(r => r.type === 1);
                if (aRecord && aRecord.data) return aRecord.data;
            }
        } catch (e) {}
        try {
            const res  = await fetch('https://api.ipify.org?format=json');
            const json = await res.json();
            return json.ip;
        } catch (e) {}
        return host;
    }

    async function sendRotorRequest() {
        if (!ipAddress) ipAddress = await fetchIpAddress();
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'Rotor', value: 'request', source: ipAddress, clientId }));
        }
    }

    function connectDataPluginsWebSocket() {
        if (ws && ws.readyState !== WebSocket.CLOSED) {
            if (mapActive) sendRotorRequest(); 
            return;
        }
        try {
            const wsProto = currentUrl.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsHost = currentUrl.hostname;
            const wsPort = currentUrl.port || (currentUrl.protocol === 'https:' ? '443' : '80');
            const wsPath = currentUrl.pathname.replace(/setup/g, '');
            const wsUrl = `${wsProto}//${wsHost}:${wsPort}${wsPath}data_plugins`;

            ws = new WebSocket(wsUrl);
            ws.addEventListener('open', async () => {
                console.log(`[${pluginName}] DataPlugins WS opened. Fetching IP...`);
                await sendRotorRequest();
            });

            ws.addEventListener('message', evt => {
                try {
                    const d = JSON.parse(evt.data);
                    if(d.type === 'GPS' && d.value?.status === 'active'){
                        gpsLat = parseFloat(d.value.lat); gpsLon = parseFloat(d.value.lon);
                    }
                    if(d.type === 'Rotor'){
                        if (d.value === 'request' && d.clientId === clientId && d._auth) {
                            isAdminLoggedIn = d._auth.admin === true; isTuneLoggedIn  = d._auth.tune  === true;
                            console.log(`[${pluginName}] Auth updated: Admin=${isAdminLoggedIn}, Tune=${isTuneLoggedIn}`);
                        }
                        if (d.lock !== undefined) isLockAuthenticated = d.lock;
                        if (d.value !== undefined && d.value !== 'request' && d.source === '127.0.0.1') {
                            const pos = parseFloat(d.value);
                            if(!isNaN(pos) && pos >= 0 && pos <= 360){
                                rotorAzDeg = pos === 360 ? 0 : pos;
                                renderRotorLine();
                                const el = document.getElementById('ms-rotor-val');
                                if(el) el.textContent = `${Math.round(rotorAzDeg)}°`;
                            }
                        }
                    }
                } catch(e) { console.warn(`[${pluginName}] Error parsing WS message:`, e); }
            });
            ws.addEventListener('close', () => {
                console.log(`[${pluginName}] DataPlugins WS closed. Reconnecting in 5s...`);
                ws = null;
                setTimeout(() => { if (mapActive) connectDataPluginsWebSocket(); }, 5000);
            });
        } catch(e) { console.warn(`[${pluginName}] Error setting up DataPlugins WS:`, e); }
    }

    // ── Styling ───────────────────────────────────────────────────────────
    const style = document.createElement('style');
    style.innerHTML = `
        #ms-wrapper{position:fixed;z-index:9000;display:flex;pointer-events:none;}
        #ms-list-panel{pointer-events:all;width:340px;background:#0d1420;border-right:1px solid #1e3050;display:flex;flex-direction:column;border-radius:12px 0 0 0;box-shadow:-2px 4px 24px rgba(0,0,0,0.7); flex-shrink:0;}
        #ms-list-header{background:var(--color-2,#162032);color:#4aaeff;font-size:12px;font-weight:bold;padding:8px 10px 6px;border-bottom:1px solid #1e3050;flex-shrink:0; display:flex; justify-content:space-between; align-items:center;}
        #ms-list-body{flex:1;overflow-y:auto;padding:6px 0;}
        #ms-list-body::-webkit-scrollbar{width:4px;}
        #ms-list-body::-webkit-scrollbar-thumb{background:#2a4a7a;border-radius:2px;}

        .ms-group{border-bottom:1px solid #1a2535;}
        .ms-group-hdr{padding:8px 10px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:10px;}
        .ms-group-hdr:hover{background:#162032;}
        .ms-group-hdr.expanded{background:#1a2535; border-left:3px solid #ffaa00; padding-left: 7px;}
        .ms-group-title{font-size:12px;font-weight:bold;color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
        .ms-group-meta{font-size:11px;color:#cde; white-space:nowrap;}
        .ms-group-flag{font-size:14px; margin-right:6px;}
        .ms-group-body{padding:0 0 6px 0;}

        .ms-prog-row{display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 10px; cursor:pointer;}
        .ms-prog-row:hover{background:#141d2b;}
        .ms-prog-left{display:flex; align-items:center; gap:8px; min-width:0;}
        .ms-freq{color:#4aaeff; font-weight:bold; font-size:12px; cursor:pointer; white-space:nowrap;}
        .ms-freq:hover{color:#fff; text-decoration:underline;}
        .ms-ps{color:#fff; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:120px;}
        .ms-pol{color:#889; font-size:11px; text-align:center; padding:0 4px;}
        .ms-prog-right{display:flex; align-items:center; gap:10px; white-space:nowrap;}
        .ms-erp{color:#cde; font-size:11px; text-align:right;}
        .ms-score{color:#ffaa00; font-weight:bold; font-size:12px; text-align:right;}

        #ms-container{pointer-events:all;background:#111827;border-radius:0 12px 0 0;box-shadow:4px 4px 32px rgba(0,0,0,0.8);display:flex;flex-direction:column;flex:1;position:relative;}
        #ms-header{display:flex;align-items:center;justify-content:space-between;padding:7px 14px;background:var(--color-2,#162032);color:#fff;cursor:move; min-height: 38px; box-sizing: border-box; flex-shrink: 0; user-select: none;}
        #ms-header .ms-title{font-size:14px;font-weight:bold;display:flex;align-items:center;gap:8px;}
        #ms-map{flex:1;width:100%;position:relative; min-height:0; display:flex; flex-direction:column;}
        #ms-leaflet-wrap{flex:1;width:100%;position:relative;}
        
        #ms-statusbar{background:#0d1420;color:#9bb;font-size:11px;padding:5px 25px 5px 12px;border-top:1px solid #1e3050; display:flex; flex-direction:column; gap:4px; flex-shrink:0;}
        .ms-tooltip{background:rgba(17,24,39,0.95);border:1px solid #ffaa00;color:#fff;padding:10px;border-radius:6px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.6);}
        .ms-tooltip b { color: #ffaa00; font-size: 13px; }

        #ms-shower-select { background:#1a2535; color:#fff; border:1px solid #2a4a7a; border-radius:4px; padding:2px 5px; font-size:12px; outline:none; }
        
        #ms-help-btn{text-decoration:none!important; color:#adf; font-size:15px; padding:0 6px; display:flex; align-items:center; line-height:1;}
        #ms-help-btn:hover{color:#fff!important;text-decoration:none!important;}
        
        #ms-settings-btn{background:none;border:none;color:#adf;font-size:15px;cursor:pointer; padding:0 6px;}
        #ms-settings-btn:hover{color:#fff;}

        #ms-settings-panel{display:none;position:absolute;top:42px;left:350px;z-index:10001;background:#1a2535;border:1px solid #2a4a7a;border-radius:8px;padding:14px 18px 12px;min-width:320px;box-shadow:0 4px 24px rgba(0,0,0,0.7);color:#cde;font-size:12px;}
        #ms-settings-panel h5{margin:0 0 10px;font-size:13px;color:#ffaa00;border-bottom:1px solid #2a4a7a;padding-bottom:6px; display:flex; justify-content:space-between; align-items:center; white-space: nowrap; cursor: move;}
        
        .ms-setting-row{display:flex;justify-content:space-between;margin-bottom:7px;align-items:center;gap:8px;}
        .ms-setting-row label {flex:1; white-space:nowrap; text-transform: uppercase; font-size: 11px; color:#4aaeff;}
        
        .ms-setting-row input[type=number], .ms-setting-row select {width:120px !important; flex: 0 0 120px !important; height:24px!important;min-height:24px!important;background:#0d1420;border:1px solid #2a4a7a;color:#fff;border-radius:4px!important;padding:2px 6px;font-size:12px;text-align:right; box-sizing:border-box;}

        .ms-setting-unit { width: 25px; text-align: left; }
        
        #ms-settings-apply{margin-top:10px;width:100%;padding:6px;background:#1a6de0!important;color:#fff!important;border:none!important;border-radius:5px!important;cursor:pointer;font-size:12px;height:auto!important;line-height:normal!important;}
        #ms-settings-apply:hover{background:#2a7df0!important;}
        #ms-settings-reset{margin-top:5px;width:100%;padding:5px;background:#2a3545!important;color:#9bb!important;border:1px solid #2a4a7a!important;border-radius:5px!important;cursor:pointer;font-size:11px;height:auto!important;line-height:normal!important;}
        #ms-settings-reset:hover{background:#3a4555!important;color:#fff!important;}

        #ms-resizer {
            position: absolute; right: 2px; bottom: 2px; width: 16px; height: 16px; cursor: nwse-resize; z-index: 10;
            background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%2388aadd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v6h-6M21 21l-7-7M3 9V3h6M3 3l7 7"/></svg>') center/contain no-repeat;
        }

        #METEORSCATTER-on-off.active{background-color:var(--color-2,#162032)!important;filter:brightness(130%);}
        
        #ms-profile-panel {
            height: 180px; flex-shrink: 0; box-sizing: border-box;
            background: rgba(17, 24, 39, 0.98); border-top: 1px solid #2a4a7a;
            display: none; flex-direction: column; width: 100%; position: relative; z-index:10;
        }
        #ms-profile-canvas { flex: 1; width: 100%; display: block; cursor: grab; }
        #ms-profile-canvas:active { cursor: grabbing; }

        #ms-profile-y-zoom-container {
            position: absolute; right: 0px; top: 0; bottom: 0; width: 35px;
            display: flex; align-items: center; justify-content: center; z-index: 20;
        }
        #ms-profile-y-zoom {
            transform: rotate(-90deg);
            width: 90px !important; min-width: 90px !important; height: 8px !important;
            flex-shrink: 0 !important; margin: 0 !important; padding: 0 !important;
            -webkit-appearance: none; background: #1e3050; border-radius: 2px; outline: none;
        }
        #ms-profile-y-zoom::-webkit-slider-thumb {
            -webkit-appearance: none; width: 0px; height: 0x; border-radius: 50%;
            background: #ffaa00; cursor: ns-resize; border: 2px solid #1a2535;
        }
        #ms-profile-y-zoom::-webkit-slider-thumb:hover { background: #fff; }
        
        .ms-sub-header {
            display: flex !important; flex-wrap: nowrap !important; align-items: center !important;
            padding: 7px 14px !important; background: var(--color-2, #162032) !important;
            border-bottom: 1px solid #1e3050 !important;
            min-height: 38px !important; flex-shrink: 0 !important; box-sizing: border-box !important;
            width: 100% !important;
        }
        .ms-sub-title {
            font-size: 13px !important; font-weight: bold !important; color: #ffaa00 !important;
            white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;
            flex: 1 1 auto !important; margin: 0 !important; padding: 0 !important; text-align: left !important;
        }
        .ms-sub-close {
            background: transparent !important; border: none !important; color: #fff !important;
            font-size: 17px !important; cursor: pointer !important; padding: 0 4px !important;
            line-height: 1 !important; margin: 0 0 0 0px !important;
        }
        .ms-sub-close:hover { color: #f66 !important; }
    `;
    document.head.appendChild(style);

    // ── Geo helpers ────────────────────────────────────────────────────────
    function haversineKm(lat1, lon1, lat2, lon2) {
        const dLat = (lat2 - lat1) * PI_180, dLon = (lon2 - lon1) * PI_180;
        const a = Math.sin(dLat / 2) ** 2
                + Math.cos(lat1 * PI_180) * Math.cos(lat2 * PI_180) * Math.sin(dLon / 2) ** 2;
        return 12742 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function bearingDeg(lat1, lon1, lat2, lon2) {
        const f1 = lat1 * PI_180, f2 = lat2 * PI_180, dl = (lon2 - lon1) * PI_180;
        return (Math.atan2(Math.sin(dl) * Math.cos(f2),
            Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)) * 180 / Math.PI + 360) % 360;
    }

    function midpointGreatCircle(lat1, lon1, lat2, lon2) {
        const f1 = lat1 * PI_180, f2 = lat2 * PI_180, l1 = lon1 * PI_180, l2 = lon2 * PI_180;
        const Bx = Math.cos(f2) * Math.cos(l2 - l1), By = Math.cos(f2) * Math.sin(l2 - l1);
        return {
            lat: Math.atan2(Math.sin(f1) + Math.sin(f2), Math.sqrt((Math.cos(f1) + Bx) ** 2 + By ** 2)) / PI_180,
            lon: (l1 + Math.atan2(By, Math.cos(f1) + Bx)) / PI_180
        };
    }

    function deadReckonRad(lat, lon, brg, distKm) {
        const d = distKm / 6371, f = lat * PI_180, l = lon * PI_180, t = brg * PI_180;
        const lat2 = Math.asin(Math.sin(f) * Math.cos(d) + Math.cos(f) * Math.sin(d) * Math.cos(t));
        return {
            lat: lat2 / PI_180,
            lon: (l + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(f), Math.cos(d) - Math.sin(f) * Math.sin(lat2))) / PI_180
        };
    }

    function gaussianAlignment(minDiffDeg, beamwidthDeg = 45) {
        const x = minDiffDeg / Math.max(1e-6, beamwidthDeg);
        return Math.exp(-(x * x));
    }
    
    function generatePathPoints(lat1, lon1, lat2, lon2, numPoints) {
        const d = haversineKm(lat1, lon1, lat2, lon2);
        const brg = bearingDeg(lat1, lon1, lat2, lon2);
        const pts = [];
        for (let i = 0; i < numPoints; i++) {
            const dist = (i / (numPoints - 1)) * d;
            pts.push(deadReckonRad(lat1, lon1, brg, dist));
        }
        return pts;
    }

    // ── Astronomy ─────────────────────────────────────────────────────────
    function getActiveShower(date) {
        if (_selectedShowerId === 'sporadic') return null;
        if (_selectedShowerId !== 'auto') return METEOR_SHOWERS.find(s => s.id === _selectedShowerId) || null;

        const m = date.getMonth() + 1, d = date.getDate();
        for (let s of METEOR_SHOWERS) {
            const startNum = s.start[0] * 100 + s.start[1];
            const endNum   = s.end[0]   * 100 + s.end[1];
            const curNum   = m * 100 + d;

            if (startNum <= endNum) {
                if (curNum >= startNum && curNum <= endNum) return s;
            } else {
                if (curNum >= startNum || curNum <= endNum) return s;
            }
        }
        return null;
    }

    function getRadiantAzAlt(raDeg, decDeg, lat, lon, date) {
        const jd = (date.getTime() / 86400000.0) + 2440587.5;
        const t  = (jd - 2451545.0) / 36525.0;

        let gmst = 280.46061837
            + 360.98564736629 * (jd - 2451545.0)
            + 0.000387933 * t * t
            - (t * t * t) / 38710000.0;

        gmst = (gmst % 360 + 360) % 360;
        const lmst = (gmst + lon) % 360;
        const ha   = (lmst - raDeg + 360) % 360;

        const decRad = decDeg * PI_180, latRad = lat * PI_180, haRad = ha * PI_180;
        const sinAlt = Math.sin(decRad) * Math.sin(latRad) + Math.cos(decRad) * Math.cos(latRad) * Math.cos(haRad);
        const altRad = Math.asin(sinAlt);

        const cosAz = (Math.sin(decRad) - Math.sin(latRad) * sinAlt) / (Math.cos(latRad) * Math.cos(altRad));
        let azRad = Math.acos(Math.max(-1, Math.min(1, cosAz)));
        if (Math.sin(haRad) > 0) azRad = 2 * Math.PI - azRad;

        return { az: azRad / PI_180, alt: altRad / PI_180 };
    }

    function getSunAltDeg(lat, lon, date) {
        const jd = (date.getTime() / 86400000.0) + 2440587.5;
        const n  = jd - 2451545.0;

        let L = (280.460 + 0.9856474 * n) % 360; if (L < 0) L += 360;
        let g = (357.528 + 0.9856003 * n) % 360; if (g < 0) g += 360;

        const lambda = L + 1.915 * Math.sin(g * PI_180) + 0.020 * Math.sin(2 * g * PI_180);
        const eps = 23.439 - 0.0000004 * n;

        const sinLambda = Math.sin(lambda * PI_180), cosLambda = Math.cos(lambda * PI_180);
        const sinEps = Math.sin(eps * PI_180), cosEps = Math.cos(eps * PI_180);

        const ra  = Math.atan2(cosEps * sinLambda, cosLambda) / PI_180;
        const dec = Math.asin(sinEps * sinLambda) / PI_180;

        const tt = (jd - 2451545.0) / 36525.0;
        let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * tt * tt - (tt * tt * tt) / 38710000.0;
        gmst = (gmst % 360 + 360) % 360;

        const lst = (gmst + lon) % 360;
        let ha = (lst - ra + 360) % 360;
        if (ha > 180) ha -= 360;

        const haRad = ha * PI_180, decRad = dec * PI_180, latRad = lat * PI_180;
        const sinAlt = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
        return Math.asin(sinAlt) / PI_180;
    }

    function getLocalSolarHour(rxLon, date) {
        const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
        let h = utcHours + (rxLon / 15);
        h = ((h % 24) + 24) % 24;
        return h;
    }

    // ── Data loading ──────────────────────────────────────────────────────
    async function loadTxDatabase(lat, lon) {
        const r = await fetch(`${FMDX_API_ENDPOINT}?qth=${lat},${lon}&radius=${S.maxDistKm}&erp=${S.minErpKw}`);
        if (!r.ok) throw new Error('API Error');
        return await r.json();
    }

    function getRxCoords() {
        if (gpsLat && gpsLon) return { lat: gpsLat, lon: gpsLon };
        const lat = parseFloat(localStorage.getItem('qthLatitude') || 0);
        const lon = parseFloat(localStorage.getItem('qthLongitude') || 0);
        return (lat && lon) ? { lat, lon } : null;
    }

    async function fetchElevationBatchLatLon(pairs) {
        if (!pairs.length) return [];
        const locs = pairs.map(p => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join('|');
        const r = await fetch(`${ELEVATION_API_LOCAL}${encodeURIComponent(locs)}`);
        if (!r.ok) return [];
        const j = await r.json();
        return j?.results || [];
    }

    async function ensureRxTerrain(rx) {
        if (rxTerrainM !== null && rxTerrainM !== undefined) return;
        try {
            const key = `ms_rx_terrain_${rx.lat.toFixed(4)}_${rx.lon.toFixed(4)}`;
            const cached = localStorage.getItem(key);
            if (cached !== null) {
                const v = parseFloat(cached);
                if (!isNaN(v)) { rxTerrainM = Math.max(0, v); return; }
            }
            const res = await fetchElevationBatchLatLon([{ lat: rx.lat, lon: rx.lon }]);
            const elev = res?.[0]?.elevation;
            if (typeof elev === 'number') {
                rxTerrainM = Math.max(0, elev);
                localStorage.setItem(key, String(rxTerrainM));
            } else {
                rxTerrainM = 0;
            }
        } catch (_) {
            rxTerrainM = 0;
        }
    }
    
    async function fetchPathElevation(rxLat, rxLon, txLat, txLon, txKey) {
        const cacheKey = rxLat.toFixed(2)+'_'+rxLon.toFixed(2)+'_'+txKey;
        if (_pathElevCache[cacheKey]) return _pathElevCache[cacheKey];

        const NUM_PTS = 75; 
        const pts = generatePathPoints(rxLat, rxLon, txLat, txLon, NUM_PTS);
        const locs = pts.map(p => p.lat.toFixed(4) + ',' + p.lon.toFixed(4)).join('|');
        
        let elevs = null;

        try {
            const r = await fetch(ELEVATION_API_LOCAL + encodeURIComponent(locs));
            if (r.ok) {
                const j = await r.json();
                if (j.results && j.results.length > 0) {
                    elevs = j.results.map(res => Math.max(0, res.elevation || 0));
                }
            }
        } catch(e) {
            console.warn('[Meteor Scatter] Server cache fetch failed');
        }

        if (!elevs || elevs.length === 0) {
            console.warn('[Meteor Scatter] Elevation APIs overloaded. Returning flat terrain temporarily.');
            return pts.map(() => 0); 
        }

        _pathElevCache[cacheKey] = elevs;
        return elevs;
    }

    // ── Elevation Profile ─────────────────────────────────────────────────
    function resizeProfileCanvas() {
        const panel = document.getElementById('ms-profile-panel');
        const canvas = document.getElementById('ms-profile-canvas');
        if(panel && canvas) {
            canvas.width = panel.clientWidth;
            canvas.height = panel.clientHeight - 38;
        }
    }

    function initProfileCanvasEvents() {
        const canvas = document.getElementById('ms-profile-canvas');
        if (!canvas) return;

        let _rafPending = false;
        function scheduleRedraw() {
            if (_rafPending) return;          
            _rafPending = true;
            requestAnimationFrame(() => {
                _rafPending = false;
                if (!_activeProfileTxKey || !_activeProfileTxObj) return;
                const rx = getRxCoords(); if (!rx) return;
                drawProfile(_currentPathElevs, rx, _activeProfileTxObj);
            });
        }

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (!_activeProfileTxKey) return;

            const rect    = canvas.getBoundingClientRect();
            const mouseX  = e.clientX - rect.left;
            const padL = 45, padR = 25, drawW = canvas.width - padL - padR;
            if (mouseX < padL || mouseX > canvas.width - padR) return;

            const range      = profMaxX - profMinX;
            const mouseKm    = profMinX + ((mouseX - padL) / drawW) * range;
            const zoomFactor = e.deltaY > 0 ? 1.15 : 0.85;
            let newRange     = Math.min(Math.max(range * zoomFactor, 5), _currentProfileDist);

            let newMin = mouseKm - ((mouseX - padL) / drawW) * newRange;
            let newMax = newMin + newRange;

            if (newMin < 0)                       { newMax -= newMin; newMin = 0; }
            if (newMax > _currentProfileDist)     { newMin -= (newMax - _currentProfileDist); newMax = _currentProfileDist; }
            if (newMin < 0)                       newMin = 0;
            if (newMax > _currentProfileDist)     newMax = _currentProfileDist;

            profMinX = newMin;
            profMaxX = newMax;
            scheduleRedraw();
        }, { passive: false });   

        canvas.addEventListener('mousedown', (e) => {
            if (_activeProfileTxKey) { isDraggingProf = true; lastMouseX = e.clientX; }
        });
        window.addEventListener('mouseup',  () => { isDraggingProf = false; });
        window.addEventListener('mousemove', (e) => {
            if (!isDraggingProf || !_activeProfileTxKey) return;
            const dx      = e.clientX - lastMouseX;
            lastMouseX    = e.clientX;
            const drawW   = canvas.width - 45 - 25;
            const range   = profMaxX - profMinX;
            const shiftKm = -(dx / drawW) * range;

            let newMin = profMinX + shiftKm;
            let newMax = profMaxX + shiftKm;

            if (newMin < 0)                        { newMin = 0; newMax = range; }
            else if (newMax > _currentProfileDist) { newMax = _currentProfileDist; newMin = _currentProfileDist - range; }

            profMinX = newMin;
            profMaxX = newMax;
            scheduleRedraw();
        });

        const yZoom = document.getElementById('ms-profile-y-zoom');
        if (yZoom) {
            yZoom.addEventListener('input', (e) => {
                profScaleY = parseFloat(e.target.value);
                scheduleRedraw();
            });
            yZoom.addEventListener('dblclick', () => {
                profScaleY = 1.0;
                yZoom.value = 1.0;
                scheduleRedraw();
            });
        }
    }

    function redrawActiveProfile() {
        if (!_activeProfileTxKey || !_activeProfileTxObj) return;
        const rx = getRxCoords(); if (!rx) return;
        drawProfile(_currentPathElevs, rx, _activeProfileTxObj);
    }
    
    function drawProfile(elevs, rx, tx) {
        const canvas = document.getElementById('ms-profile-canvas');
        if(!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const d_txrx = haversineKm(tx.lat, tx.lon, rx.lat, rx.lon);
        _currentProfileDist = d_txrx;

        if (profMaxX === 0) { profMinX = 0; profMaxX = d_txrx; }

        const padT = 35, padB = 25, padL = 45, padR = 35;
        const drawW = w - padL - padR, drawH = h - padT - padB;

        if (!elevs || elevs.length === 0) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(padL, padT, drawW, drawH);
            ctx.fillStyle = '#adf'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('⏳ Fetching Topography Data...', padL + drawW/2, padT + drawH/2);
            return;
        }

        const rxBase = Math.max(rxTerrainM || 0, elevs[0]);
        const rxAgl = (typeof S !== 'undefined' && S.rxAglM) ? Number(S.rxAglM) : 10;
        const rxAltM = rxBase + rxAgl;

        const txBase = Math.max((tx.terrainM || 0), elevs[elevs.length - 1]);
        const txAgl = (typeof S !== 'undefined' && S.txAglM) ? Number(S.txAglM) : 150;
        const txAltM = txBase + txAgl;

        const losFloor = [];
        const stepKm = d_txrx / (elevs.length - 1);
        const c_factor = 16.974;

        const m_min_rx = -2 * Math.sqrt(Math.max(1, rxAgl) / c_factor);
        const m_min_tx = -2 * Math.sqrt(Math.max(1, txAgl) / c_factor);

        let m_max_rx = m_min_rx;
        const hrx_arr = new Float64Array(elevs.length);
        for (let i = 0; i < elevs.length; i++) {
            const x = i * stepKm;
            if (x === 0) { hrx_arr[i] = rxAltM; }
            else {
                const c_drop = (x * x) / c_factor;
                const m = (elevs[i] - rxAltM - c_drop) / x;
                if (m > m_max_rx) m_max_rx = m;
                hrx_arr[i] = rxAltM + m_max_rx * x + c_drop;
            }
        }

        let m_max_tx = m_min_tx;
        const htx_arr = new Float64Array(elevs.length);
        for (let i = elevs.length - 1; i >= 0; i--) {
            const d_tx = d_txrx - (i * stepKm);
            if (d_tx === 0) { htx_arr[i] = txAltM; }
            else {
                const c_drop = (d_tx * d_tx) / c_factor;
                const m = (elevs[i] - txAltM - c_drop) / d_tx;
                if (m > m_max_tx) m_max_tx = m;
                htx_arr[i] = txAltM + m_max_tx * d_tx + c_drop;
            }
        }

        let minPurpleH = Infinity;
        for (let i = 0; i < elevs.length; i++) {
            const ptMax = Math.max(hrx_arr[i], htx_arr[i]);
            losFloor.push({ x: i * stepKm, hrx: hrx_arr[i], htx: htx_arr[i], max: ptMax });
            if (ptMax < minPurpleH) minPurpleH = ptMax;
        }

        const meteorAltM = S.meteorAltKm * 1000;
        let maxH = Math.max(meteorAltM, (minPurpleH !== Infinity ? minPurpleH + 1000 : 12000));
        let minH = 0;

        for(let i=0; i<elevs.length; i++){ if(elevs[i] > maxH) maxH = elevs[i]; }
        if (rxAltM > maxH) maxH = rxAltM;
        if (txAltM > maxH) maxH = txAltM;
        
        maxH *= 1.1;
        maxH /= profScaleY;

        const scaleX = drawW / (profMaxX - profMinX), scaleY = drawH / (maxH - minH);
        const mapX = xKm => padL + (xKm - profMinX) * scaleX;
        const mapY = zM  => h - padB - (zM - minH) * scaleY;

        ctx.fillStyle = '#668'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (let i = 0; i <= 4; i++) {
            const levelM = minH + (maxH - minH) * (i / 4);
            const yCanvas = mapY(levelM);
            
            const levelDisp = S.useMetric ? Math.round(levelM / 1000) + ' km' : Math.round((levelM * 3.28084) / 1000) + ' k ft'; 
            ctx.fillText(levelDisp, padL - 5, yCanvas);
            
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(padL, yCanvas); ctx.lineTo(w - padR, yCanvas); ctx.stroke();
        }

        ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, drawW, drawH); ctx.clip();

        // LAYER 1: Solid blue terrain
        ctx.beginPath(); ctx.moveTo(mapX(0), h - padB);
        for(let i=0; i<elevs.length; i++) ctx.lineTo(mapX(i * stepKm), mapY(elevs[i]));
        ctx.lineTo(mapX(d_txrx), h - padB); ctx.closePath();
        ctx.fillStyle = '#1e3050'; ctx.fill(); 
        ctx.strokeStyle = '#2a4a7a'; ctx.lineWidth = 2; ctx.stroke();

        let highestRenderM = meteorAltM + 5000;

        // LAYER 2: Line of Sight Lines
        ctx.beginPath();
        losFloor.forEach((pt, i) => i === 0 ? ctx.moveTo(mapX(pt.x), mapY(pt.hrx)) : ctx.lineTo(mapX(pt.x), mapY(pt.hrx)));
        ctx.strokeStyle = 'rgba(255, 50, 50, 0.8)'; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.beginPath();
        losFloor.forEach((pt, i) => i === 0 ? ctx.moveTo(mapX(pt.x), mapY(pt.htx)) : ctx.lineTo(mapX(pt.x), mapY(pt.htx)));
        ctx.strokeStyle = 'rgba(255, 200, 50, 0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
        
        // LAYER 3: Meteor Point
        const midPointX = d_txrx / 2;
        const color = '#ffaa00';
        
        ctx.strokeStyle = color + '55'; ctx.lineWidth = 1.0; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(mapX(0), mapY(rxAltM)); ctx.lineTo(mapX(midPointX), mapY(meteorAltM)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(mapX(midPointX), mapY(meteorAltM)); ctx.lineTo(mapX(d_txrx), mapY(txAltM)); ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(mapX(midPointX), mapY(meteorAltM), 4, 0, Math.PI*2); ctx.fill();

        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '11px sans-serif';
        const labelStr = 'Meteor | ' + fmtAlt(meteorAltM);
        let textX = mapX(midPointX);
        let textY = mapY(meteorAltM) - 12;
        ctx.fillText(labelStr, textX, textY);

        ctx.strokeStyle = '#668'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(mapX(0), mapY(elevs[0])); ctx.lineTo(mapX(0), mapY(rxAltM)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(mapX(d_txrx), mapY(elevs[elevs.length-1])); ctx.lineTo(mapX(d_txrx), mapY(txAltM)); ctx.stroke();

        ctx.restore();

        ctx.fillStyle = '#668';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const isMetric  = S.useMetric;
        const distConv  = isMetric ? 1 : 0.621371;
        const viewDistDisp = (profMaxX - profMinX) * distConv;

        let tickStep = 10;
        if (viewDistDisp > 800) tickStep = 200;
        else if (viewDistDisp > 400) tickStep = 100;
        else if (viewDistDisp > 200) tickStep = 50;
        else if (viewDistDisp > 100) tickStep = 25;

        const startDisp = Math.ceil((profMinX * distConv) / tickStep) * tickStep;
        const endDisp   = Math.floor((profMaxX * distConv) / tickStep) * tickStep;
        const unitStr   = isMetric ? ' km' : ' mi';

        for (let d = startDisp; d <= endDisp; d += tickStep) {
            const xKm    = d / distConv;
            const screenX = mapX(xKm);
            if (screenX > padL + 30 && screenX < (w - padR) - 30) {
                ctx.fillText(d + unitStr, screenX, h - padB + 12);
                ctx.strokeStyle = '#2a4a7a'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(screenX, h - padB); ctx.lineTo(screenX, h - padB + 4); ctx.stroke();
            }
        }

        if (profMinX <= 0)      { ctx.fillStyle = '#adf'; ctx.textAlign = 'center'; ctx.fillText('RX', mapX(0),       h - padB + 12); }
        if (profMaxX >= d_txrx) { ctx.fillStyle = '#adf'; ctx.textAlign = 'center'; ctx.fillText('TX', mapX(d_txrx), h - padB + 12); }
    }
    
    function initProfileCanvasHover() {
        const canvas = document.getElementById('ms-profile-canvas');
        if (!canvas) return;

        let _hoverTooltip = null;

        canvas.addEventListener('mousemove', (e) => {
            if (!_activeProfileTxKey || !_activeProfileTxObj || !_currentPathElevs || _currentPathElevs.length === 0) return;

            const rx = getRxCoords();
            if (!rx) return;

            const tx       = _activeProfileTxObj;
            const d_txrx   = haversineKm(tx.lat, tx.lon, rx.lat, rx.lon);
            const elevs    = _currentPathElevs;

            const rect  = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const w = canvas.width, h = canvas.height;
            const padT = 35, padB = 25, padL = 45, padR = 35;
            const drawW = w - padL - padR;

            if (mouseX < padL || mouseX > w - padR || mouseY < padT || mouseY > h - padB) {
                if (_hoverTooltip) { _hoverTooltip.remove(); _hoverTooltip = null; }
                return;
            }

            const range   = profMaxX - profMinX;
            const xKm     = profMinX + ((mouseX - padL) / drawW) * range;
            if (xKm < 0 || xKm > d_txrx) {
                if (_hoverTooltip) { _hoverTooltip.remove(); _hoverTooltip = null; }
                return;
            }

            const stepKm   = d_txrx / (elevs.length - 1);
            const rawIdx   = xKm / stepKm;
            const idxLo    = Math.max(0, Math.floor(rawIdx));
            const idxHi    = Math.min(elevs.length - 1, idxLo + 1);
            const frac     = rawIdx - idxLo;
            const terrainM = elevs[idxLo] * (1 - frac) + elevs[idxHi] * frac;

            const txAltM = (tx.terrainM || 0) + S.txAglM;
            const rxAltM = (rxTerrainM || 0) + S.rxAglM;

            const d_rx = xKm;            
            const d_tx = d_txrx - xKm;  

            const elevAngleFromRx = d_rx > 0
                ? toDeg(Math.atan2(terrainM - rxAltM, d_rx * 1000))
                : 0;
            const elevAngleFromTx = d_tx > 0
                ? toDeg(Math.atan2(terrainM - txAltM, d_tx * 1000))
                : 0;

            const distDisp = S.useMetric
                ? xKm.toFixed(1) + ' km'
                : (xKm * 0.621371).toFixed(1) + ' mi';

            const html = `
                <div style="
                    position:fixed;
                    left:${e.clientX + 14}px;
                    top:${e.clientY - 10}px;
                    z-index:99999;
                    background:rgba(13,20,32,0.97);
                    border:1px solid #2a4a7a;
                    border-radius:6px;
                    padding:8px 12px;
                    font-size:11px;
                    color:#cde;
                    pointer-events:none;
                    box-shadow:0 4px 16px rgba(0,0,0,0.7);
                    min-width:160px;
                ">
                    <table style="border-collapse:collapse;width:100%;">
                        <tr>
                            <td style="color:#889;">Distance (RX)</td>
                            <td style="color:#fff;text-align:right;">${distDisp}</td>
                        </tr>
                        <tr>
                            <td style="color:#889;">Distance (TX)</td>
                            <td style="color:#fff;text-align:right;">${S.useMetric ? d_tx.toFixed(1) + ' km' : (d_tx * 0.621371).toFixed(1) + ' mi'}</td>
                        </tr>
                        <tr>
                            <td style="color:#889;">Terrain</td>
                            <td style="color:#fff;text-align:right;">${fmtAlt(terrainM)}</td>
                        </tr>
                        <tr><td colspan="2" style="border-top:1px solid #2a4a7a;padding-top:4px;"></td></tr>
                        <tr>
                            <td style="color:#889;">El. angle (RX)</td>
                            <td style="color:#f55;text-align:right;">${elevAngleFromRx.toFixed(2)}°</td>
                        </tr>
                        <tr>
                            <td style="color:#889;">El. angle (TX)</td>
                            <td style="color:#fc0;text-align:right;">${elevAngleFromTx.toFixed(2)}°</td>
                        </tr>
                    </table>
                </div>`;

            if (!_hoverTooltip) {
                _hoverTooltip = document.createElement('div');
                document.body.appendChild(_hoverTooltip);
            }
            _hoverTooltip.innerHTML = html;
        });

        canvas.addEventListener('mouseleave', () => {
            if (_hoverTooltip) { _hoverTooltip.remove(); _hoverTooltip = null; }
        });
    }

    // ── Scoring ───────────────────────────────────────────────────────────
    function calcMeteorScatter(rxLat, rxLon, tx, ctx) {
        const dist = haversineKm(rxLat, rxLon, tx.lat, tx.lon);
        if (dist < S.minDistKm || dist > S.maxDistKm) return null;

        const txBrg = bearingDeg(rxLat, rxLon, tx.lat, tx.lon);
        let score = 100;

        if (dist < 1200) score -= (1200 - dist) * 0.05;
        if (dist > 1600) score -= (dist - 1600) * 0.05;

        score += Math.min(15, Math.log10(Math.max(1e-6, tx.erp)) * 5);

        if (ctx.showerMode && ctx.radiantAz !== null) {
            const diff1 = Math.abs(txBrg - ctx.ideal1), adiff1 = Math.min(diff1, 360 - diff1);
            const diff2 = Math.abs(txBrg - ctx.ideal2), adiff2 = Math.min(diff2, 360 - diff2);
            const minDiff = Math.min(adiff1, adiff2);

            const alignment = gaussianAlignment(minDiff, 45);
            score *= (0.25 + 0.75 * alignment);

            if (ctx.radiantAlt !== null) {
                const elevFactor = 0.4 + 0.6 * Math.max(0, Math.sin(ctx.radiantAlt * PI_180));
                score *= elevFactor;
            }

            const zhrFactor = 0.4 + 0.6 * Math.min(1, ctx.zhr / 100);
            score *= zhrFactor;
        }

        score *= ctx.diurnalMulti;

        if (ctx.sunWeighting && ctx.sunAltDeg !== null && ctx.sunAltDeg !== undefined) {
            const sunAlt = clamp(ctx.sunAltDeg, -18, 20);
            const t = (sunAlt + 18) / (20 + 18);
            const sunFactor = 1.10 + (0.95 - 1.10) * t;
            score *= sunFactor;
        }

        score = clamp(Math.round(score), 0, 100);

        const pseudoRand = (Math.sin(tx.lat * 12345 + tx.lon) + 1) / 2;
        const altM = (S.meteorAltKm * 1000) - 5000 + (pseudoRand * 10000); 

        const mid = midpointGreatCircle(tx.lat, tx.lon, rxLat, rxLon);
        const d_mid = dist / 2;
        const curvatureDropM = (Math.pow(d_mid, 2) / (2 * 6371)) * 1000;
        const elevAngleDeg = Math.atan2(altM - curvatureDropM, d_mid * 1000) * (180 / Math.PI);

        if (elevAngleDeg < 0.5) return null;

        return { tx, mid, dist, elevAngleDeg, score, txBrg };
    }

    function computeCutoff(sortedCands) {
        if (!sortedCands || sortedCands.length === 0) return 101;

        const absoluteFloor = 8;
        const userMin = clamp(parseInt(S.minScore, 10) || 30, 0, 100);

        if (S.strictMinScore) return Math.max(absoluteFloor, userMin);

        const targetN = clamp(parseInt(S.targetTopN, 10) || 80, 10, 500);
        const idx = Math.min(sortedCands.length - 1, targetN - 1);
        const qCut = sortedCands[idx].score;

        let cutoff = Math.max(absoluteFloor, userMin);

        const firstBelow = sortedCands.findIndex(c => c.score < cutoff);
        const strictCount = (firstBelow === -1) ? sortedCands.length : firstBelow;

        if (strictCount < Math.min(targetN, sortedCands.length)) {
            cutoff = Math.max(absoluteFloor, qCut);
        }

        return cutoff;
    }

    // ── Grouping helpers ───────────────────────────────────────────────────
    function groupCandidatesByLocation(cands) {
        const groups = new Map();

        for (const c of cands) {
            const tx = c.tx;
            const key = `${(tx.city || '').trim()}|${(tx.itu || '').trim()}|${tx.lat.toFixed(3)}|${tx.lon.toFixed(3)}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    city: tx.city || '',
                    itu: tx.itu || '',
                    lat: tx.lat,
                    lon: tx.lon,
                    distKm: c.dist,
                    bestScore: c.score,
                    bestCand: c,
                    items: []
                });
            }
            const g = groups.get(key);
            g.items.push(c);
            if (c.score > g.bestScore) {
                g.bestScore = c.score;
                g.bestCand = c;
                g.distKm = c.dist;
            }
        }

        const list = Array.from(groups.values());
        list.forEach(g => g.items.sort((a,b) => b.score - a.score));
        list.sort((a,b) => b.bestScore - a.bestScore);
        return list;
    }

    // ── Rotor overlay ──────────────────────────────────────────────────────
    function renderRotorLine() {
        if (!mapInstance || !rotorLayer || !currentRx) return;
        rotorLayer.clearLayers();

        if (rotorAzDeg === null || rotorAzDeg === undefined) return;

        const p = deadReckonRad(currentRx.lat, currentRx.lon, rotorAzDeg, 2000);
        const poly = L.polyline([[currentRx.lat, currentRx.lon], [p.lat, p.lon]], {
            color: '#ff0000',
            weight: 3,
            opacity: 0.85
        }).addTo(rotorLayer);

        poly.bindTooltip(`Rotor: ${Math.round(rotorAzDeg)}°`, { sticky: true });
    }

    // ── UI ────────────────────────────────────────────────────────────────
    function buildSettingsPanel() {
        return `
            <div id="ms-settings-panel">
                <h5>
                    <span style="color:#ffaa00; pointer-events: none;">⚙️ Settings & Filters</span>
                    <button id="ms-settings-close" class="ms-sub-close" style="background:none;border:none;color:#fff;cursor:pointer;font-size:14px;line-height:1;padding:0;margin:0;transform:translateX(100px);">✕</button>
                </h5>

                <div class="ms-setting-row"><label>Min Distance</label><input type="number" id="ms-s-min-dist" value="${S.minDistKm}"><span class="ms-setting-unit">km</span></div>
                <div class="ms-setting-row"><label>Max Distance</label><input type="number" id="ms-s-max-dist" value="${S.maxDistKm}"><span class="ms-setting-unit">km</span></div>
                <div class="ms-setting-row"><label>Min TX ERP</label><input type="number" id="ms-s-min-erp" value="${S.minErpKw}"><span class="ms-setting-unit">kW</span></div>

                <div class="ms-setting-row"><label>Min Score</label><input type="number" id="ms-s-min-score" value="${S.minScore}"><span class="ms-setting-unit">%</span></div>

                <div class="ms-setting-row">
                    <label>Strict Min Score</label>
                    <select id="ms-s-strict-minscore">
                        <option value="1" ${S.strictMinScore ? 'selected' : ''}>On (strict)</option>
                        <option value="0" ${!S.strictMinScore ? 'selected' : ''}>Off (auto relax)</option>
                    </select>
                    <span class="ms-setting-unit"></span>
                </div>

                <div class="ms-setting-row">
                    <label>Frequency Filter</label>
                    <select id="ms-s-filter-mode">
                        <option value="none" ${S.filterMode === 'none' ? 'selected' : ''}>Off</option>
                        <option value="blacklist" ${S.filterMode === 'blacklist' ? 'selected' : ''}>Blacklist</option>
                        <option value="whitelist" ${S.filterMode === 'whitelist' ? 'selected' : ''}>Whitelist</option>
                    </select>
                    <span class="ms-setting-unit"></span>
                </div>

                <div class="ms-setting-row"><label>Target candidates</label><input type="number" id="ms-s-topn" value="${S.targetTopN}"><span class="ms-setting-unit"></span></div>
                <div class="ms-setting-row"><label>Map draw limit</label><input type="number" id="ms-s-maptopn" value="${S.mapTopN}"><span class="ms-setting-unit"></span></div>

                <div class="ms-setting-row">
                    <label>Sun weighting</label>
                    <select id="ms-s-sun-weighting">
                        <option value="1" ${S.sunWeighting ? 'selected' : ''}>On</option>
                        <option value="0" ${!S.sunWeighting ? 'selected' : ''}>Off</option>
                    </select>
                    <span class="ms-setting-unit"></span>
                </div>

                <h5 style="margin-top:10px; cursor: move;">
                    <span style="color:#ffaa00; pointer-events: none;">Terrain</span>
                </h5>

                <div class="ms-setting-row"><label>RX antenna height AGL</label><input type="number" id="ms-s-rx-agl" value="${S.rxAglM}"><span class="ms-setting-unit">m</span></div>
                <div class="ms-setting-row"><label>Assumed TX antenna height AGL</label><input type="number" id="ms-s-tx-agl" value="${S.txAglM}"><span class="ms-setting-unit">m</span></div>

                <div class="ms-setting-row">
                    <label>Collapse groups by default</label>
                    <select id="ms-s-group-collapse">
                        <option value="1" ${S.groupCollapse ? 'selected' : ''}>On</option>
                        <option value="0" ${!S.groupCollapse ? 'selected' : ''}>Off</option>
                    </select>
                    <span class="ms-setting-unit"></span>
                </div>
                
                <div style="border-top:1px solid #2a4a7a;margin:8px 0 6px;"></div>
                <div class="ms-setting-row">
                    <label style="color:#fff;">Use Metric System</label>
                    <input type="checkbox" id="ms-s-metric" ${S.useMetric ? 'checked' : ''} style="width:auto; cursor:pointer;">
                </div>
                <div class="ms-setting-row">
                    <label style="color:#fff;">Web server automatically right-aligned</label>
                    <input type="checkbox" id="ms-s-rightalign" ${S.autoRightAlign ? 'checked' : ''} style="width:auto; cursor:pointer;">
                </div>

                <button id="ms-settings-apply">✔ Apply & Reload</button>
                <button id="ms-settings-reset">↺ Reset to defaults</button>
            </div>
        `;
    }

    async function renderMap() {
        if (!mapInstance || !hotspotLayer || !lineLayer || !txLayer || !radiantLayer || !rotorLayer) return;
        if (!currentRx) return;

        hotspotLayer.clearLayers();
        lineLayer.clearLayers();
        txLayer.clearLayers();
        radiantLayer.clearLayers();

        if (!rxMarker) {
            rxMarker = L.marker([currentRx.lat, currentRx.lon], {
                icon: L.divIcon({ html: '<div style="width:16px;height:16px;background:#2196F3;border-radius:50%;border:2px solid #fff; box-shadow:0 0 4px rgba(0,0,0,0.5);"></div>', className: '', iconSize:[16,16], iconAnchor:[8,8] }),
                zIndexOffset: 2000
            }).addTo(mapInstance);
        } else {
            rxMarker.setLatLng([currentRx.lat, currentRx.lon]);
        }

        if (currentRadiantAz !== null) {
            const p1 = deadReckonRad(currentRx.lat, currentRx.lon, (currentRadiantAz + 90) % 360, 2000);
            const p2 = deadReckonRad(currentRx.lat, currentRx.lon, (currentRadiantAz + 270) % 360, 2000);

            const isAbove = currentRadiantAlt > 0;
            const dashStyle = isAbove ? '10,10' : '4,8';
            const color = isAbove ? '#00ffff' : '#008888';
            const tooltipText = isAbove ? "Ideal Line (Forward Scatter)" : "Ideal Line (Radiant below horizon)";

            L.polyline([[currentRx.lat, currentRx.lon], [p1.lat, p1.lon]], { color: color, weight: 3, opacity: 0.6, dashArray: dashStyle })
                .addTo(radiantLayer)
                .bindTooltip(tooltipText, { sticky: true });

            L.polyline([[currentRx.lat, currentRx.lon], [p2.lat, p2.lon]], { color: color, weight: 3, opacity: 0.6, dashArray: dashStyle })
                .addTo(radiantLayer);
        }

        let itemsToDraw;
        if (focusedCand) {
            const groupKey = `${(focusedCand.tx.city || '').trim()}|${(focusedCand.tx.itu || '').trim()}|${focusedCand.tx.lat.toFixed(3)}|${focusedCand.tx.lon.toFixed(3)}`;
            itemsToDraw = currentCands.filter(c => {
                const k = `${(c.tx.city || '').trim()}|${(c.tx.itu || '').trim()}|${c.tx.lat.toFixed(3)}|${c.tx.lon.toFixed(3)}`;
                return k === groupKey;
            });
            if(itemsToDraw.length === 0) itemsToDraw = [focusedCand];
        }
        else itemsToDraw = currentCands.slice(0, clamp(S.mapTopN, 20, 800));

        for (const c of itemsToDraw) {
            const color = c.score >= 80 ? '#ff3300' : c.score >= 60 ? '#ffaa00' : c.score >= 40 ? '#eecc00' : '#44cc44';
            const isFocused = focusedCand && c.tx.lat === focusedCand.tx.lat && c.tx.lon === focusedCand.tx.lon;

            const circ = L.circle([c.mid.lat, c.mid.lon], {
                color, fillColor: color, fillOpacity: isFocused ? 0.4 : 0.25,
                radius: 25000, weight: isFocused ? 2 : 1
            }).bindTooltip(`<div class="ms-tooltip"><b>Meteor Scatter Hotspot</b><br>Score: ${c.score}%<br>Elev Angle: ${c.elevAngleDeg.toFixed(1)}°</div>`)
              .addTo(hotspotLayer);

            const txHtml = `<div style="width:12px;height:12px;background:${color};border-radius:50%;border:2px solid #fff; box-shadow:0 0 3px rgba(0,0,0,0.5);"></div>`;
            const txM = L.marker([c.tx.lat, c.tx.lon], {
                icon: L.divIcon({ html: txHtml, className: '', iconSize:[12,12], iconAnchor:[6,6] }),
                zIndexOffset: isFocused ? 1000 : 100
            });
            
            const flagHtml = getFlagImg(c.tx.itu, 20, 15);
            txM.bindTooltip(`
                <div class="ms-tooltip">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <span style="font-size:14px; font-weight:bold; color:#fff;">${c.tx.city}</span>
                        ${flagHtml ? `<span style="margin-left:8px;">${flagHtml}</span>` : ''}
                    </div>
                    <table style="width:100%; border-collapse:collapse; font-size:12px;">
                        <tr><td style="color:#889; padding:2px;">Distance</td><td style="text-align:right; color:#fff;">${fmtDist(c.dist)}</td></tr>
                        <tr><td style="color:#889; padding:2px;">Terrain</td><td style="text-align:right; color:#fff;">${fmtAlt(c.tx.terrainM || 0)}</td></tr>
                        <tr><td style="color:#889; padding:2px;">Score</td><td style="text-align:right; color:${color}; font-weight:bold;">${c.score}%</td></tr>
                    </table>
                </div>
            `, { direction: 'top', sticky: true, opacity: 1 });
            
            txLayer.addLayer(txM);

            L.polyline([[currentRx.lat, currentRx.lon], [c.mid.lat, c.mid.lon], [c.tx.lat, c.tx.lon]], {
                color, weight: isFocused ? 2.5 : 1.5, opacity: isFocused ? 0.8 : 0.3,
                dashArray: '5,5', interactive: false
            }).addTo(lineLayer);

            txM.on('click', async (e) => {
                L.DomEvent.stopPropagation(e);
                focusedCand = c;
                renderMap();
                renderList();
                
                const groupKey = `${(c.tx.city || '').trim()}|${(c.tx.itu || '').trim()}|${c.tx.lat.toFixed(3)}|${c.tx.lon.toFixed(3)}`;
                setTimeout(() => {
                    const hdr = document.querySelector(`.ms-group-hdr[data-key="${groupKey}"]`);
                    if(hdr) {
                        const body = hdr.nextElementSibling;
                        if(body && body.style.display === 'none') hdr.click();
                        hdr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 100);
                
                // Show profile
                _activeProfileTxKey = c.tx.lat + '_' + c.tx.lon + '_' + c.tx.freq;
                _activeProfileTxObj = c.tx;
                profMinX = 0;
                profMaxX = 0;
                document.getElementById('ms-profile-panel').style.display = 'flex';
                resizeProfileCanvas();
                _currentPathElevs = await fetchPathElevation(currentRx.lat, currentRx.lon, c.tx.lat, c.tx.lon, _activeProfileTxKey);
                redrawActiveProfile();
            });
        }

        renderRotorLine();

        if (focusedCand) {
            mapInstance.fitBounds([[currentRx.lat, currentRx.lon], [focusedCand.tx.lat, focusedCand.tx.lon]], { padding: [50, 50], maxZoom: 8 });
        } else if (itemsToDraw.length > 0) {
            const bounds = L.latLngBounds([currentRx.lat, currentRx.lon]);
            itemsToDraw.forEach(c => bounds.extend([c.tx.lat, c.tx.lon]));
            mapInstance.fitBounds(bounds, { padding: [30, 30] });
            
            // Hide profile
            document.getElementById('ms-profile-panel').style.display = 'none';
            _activeProfileTxKey = null;
            _activeProfileTxObj = null;
            if(mapInstance) mapInstance.invalidateSize();
        }
    }

    function renderList() {
        const body = document.getElementById('ms-list-body');
        if (!body) return;

        body.innerHTML = '';

        const groups = groupCandidatesByLocation(currentCands);
        
        // Ensure this defaults to true if S.groupCollapse is truthy
        const collapsedDefault = !!S.groupCollapse;

        let focusedGroupKey = null;
        if(focusedCand) {
            focusedGroupKey = `${(focusedCand.tx.city || '').trim()}|${(focusedCand.tx.itu || '').trim()}|${focusedCand.tx.lat.toFixed(3)}|${focusedCand.tx.lon.toFixed(3)}`;
        }

        if(groups.length === 0) {
            body.innerHTML = '<div style="padding:10px;color:#668;">No hotspots found. Adjust settings or wait for meteor showers.</div>';
            return;
        }

        for (const g of groups) {
            const groupEl = document.createElement('div');
            groupEl.className = 'ms-group';

            const isFocusedGroup = (g.key === focusedGroupKey);
            
            const hdr = document.createElement('div');
            hdr.className = 'ms-group-hdr' + (isFocusedGroup ? ' expanded' : '');
            hdr.dataset.key = g.key;

            const left = document.createElement('div');
            left.style.minWidth = '0';

            const flagHtml = getFlagImg(g.itu, 16, 12);
            const prefix = flagHtml ? `<span class="ms-group-flag">${flagHtml}</span>` : `<span class="ms-group-flag">📡</span>`;
            
            left.innerHTML = `
                <div class="ms-group-title">
                    ${prefix}${g.city} [${g.itu || '?'}]
                </div>
                <div class="ms-group-meta">Distance: ${fmtDist(g.distKm)} | Terrain: ${fmtAlt(g.bestCand.tx.terrainM || 0)}</div>
            `;

            const right = document.createElement('div');
            const bestScore = Math.round(g.bestScore);
            const scoreColor = bestScore >= 80 ? '#ff3300' : bestScore >= 60 ? '#ffaa00' : bestScore >= 40 ? '#eecc00' : '#44cc44';
            right.innerHTML = `<span style="color:${scoreColor}; font-weight:bold; font-size:18px;">${bestScore}%</span>`;

            hdr.appendChild(left);
            hdr.appendChild(right);

            const groupBody = document.createElement('div');
            groupBody.className = 'ms-group-body';
            
            // Logic to determine if this specific group should be expanded
            let forceExpand = false;
            if(focusedCand) {
                if(isFocusedGroup) forceExpand = true;
            }
            
            // If it's forced to expand (because it's focused) OR if collapsedDefault is false, show it.
            // Since we WANT them collapsed by default, if collapsedDefault is TRUE, and it's not focused, it should be 'none'.
            groupBody.style.display = (forceExpand || !collapsedDefault) ? 'block' : 'none';
            
            // Sync the header class with the initial display state
            if (groupBody.style.display === 'block') {
                 hdr.classList.add('expanded');
            } else {
                 hdr.classList.remove('expanded');
            }

            hdr.onclick = () => {
                const isHidden = groupBody.style.display === 'none';
                
                if (isHidden) {
                    groupBody.style.display = 'block';
                    hdr.classList.add('expanded');
                    if (g.bestCand) {
                        focusedCand = g.bestCand;
                        renderMap();
                    }
                } else {
                    groupBody.style.display = 'none';
                    hdr.classList.remove('expanded');
                    if (focusedCand && focusedCand.tx.lat === g.bestCand.tx.lat && focusedCand.tx.lon === g.bestCand.tx.lon) {
                        focusedCand = null;
                        renderMap();
                        renderList();
                    }
                }
            };

            for (const c of g.items) {
                const row = document.createElement('div');
                row.className = 'ms-prog-row';

                const ps = (c.tx.ps || c.tx.station || '').trim();
                const psLabel = ps ? ps : '—';
                const freqNum = Number(c.tx.freq);
                const txIdStr = (c.tx.id !== undefined && c.tx.id !== null) ? `'${c.tx.id}'` : 'null';
                const itemScoreColor = c.score >= 80 ? '#ff3300' : c.score >= 60 ? '#ffaa00' : c.score >= 40 ? '#eecc00' : '#44cc44';

                row.innerHTML = `
                    <div class="ms-prog-left">
                        <i class="fas fa-play ms-stream-btn" style="color:#4aaeff; font-size:13px; cursor:pointer;" onclick="(function(e){ e.stopPropagation(); if(${txIdStr}) window._msHandleStreamClick(${txIdStr}, '${psLabel.replace(/'/g,"\\'")}', e.currentTarget); else alert('No stream ID'); })(event)"></i>
                        <div class="ms-freq" data-freq="${freqNum}">${freqNum.toFixed(2)} MHz</div>
                        <div class="ms-ps" title="${psLabel}">${psLabel}</div>
                    </div>
                    <div class="ms-prog-right">
                        <div class="ms-pol">${c.tx.pol || '—'}</div>
                        <div class="ms-erp">${Math.round(c.tx.erp)} kW</div>
                        <div class="ms-score" style="color:${itemScoreColor}; text-align:right;">${Math.round(c.score)}%</div>
                    </div>
                `;

                row.onclick = () => {
                    focusedCand = c;
                    renderMap();
                    renderList();
                };

                row.querySelector('.ms-freq').onclick = (ev) => {
                    ev.stopPropagation();
                    onFrequencyClick(freqNum);
                };

                groupBody.appendChild(row);
            }

            groupEl.appendChild(hdr);
            groupEl.appendChild(groupBody);

            body.appendChild(groupEl);
        }
    }

    async function updateData() {
        const rx = getRxCoords();
        if (!rx) return;

        const statEl = document.getElementById('ms-stat-msg');
        if (statEl) statEl.innerHTML = '<span style="color:#4aaeff;"><i class="fas fa-spinner fa-spin"></i> Loading TX database...</span>';

        if (txStations.length === 0) {
            try { txStations = await loadTxDatabase(rx.lat, rx.lon); }
            catch (e) { if (statEl) statEl.innerHTML = '<span style="color:#f66;">Error loading database</span>'; return; }
        }

        currentRx = rx;

        await ensureRxTerrain(rx);
        
        const filterFreqs = await fetchFrequencyList(S.filterMode);

        const now = new Date();

        const localHour = getLocalSolarHour(rx.lon, now);
        const diurnalMulti = 0.7 + 0.8 * Math.exp(-Math.pow((localHour - 6) / 3.2, 2));

        const activeShower = getActiveShower(now);
        const sunAltDeg = getSunAltDeg(rx.lat, rx.lon, now);

        const ctx = {
            showerMode: false,
            radiantAz: null,
            radiantAlt: null,
            zhr: 0,
            ideal1: null,
            ideal2: null,
            diurnalMulti,
            sunAltDeg,
            sunWeighting: !!S.sunWeighting,
        };

        if (activeShower) {
            const azAlt = getRadiantAzAlt(activeShower.ra, activeShower.dec, rx.lat, rx.lon, now);
            ctx.showerMode = true;
            ctx.radiantAz = azAlt.az;
            ctx.radiantAlt = azAlt.alt;
            ctx.zhr = activeShower.zhr;
            ctx.ideal1 = (azAlt.az + 90) % 360;
            ctx.ideal2 = (azAlt.az + 270) % 360;

            currentRadiantAz = ctx.radiantAz;
            currentRadiantAlt = ctx.radiantAlt;
        } else {
            currentRadiantAz = null;
            currentRadiantAlt = null;
        }

        // 1. Calculate all TX (without frequency filter)
        let cands = [];
        for (const tx of txStations) {
            const ms = calcMeteorScatter(rx.lat, rx.lon, tx, ctx);
            if (ms) cands.push(ms);
        }

        cands.sort((a, b) => b.score - a.score);

        // 2. Compute Cutoff and Limits as if the filter is OFF
        const cutoff = computeCutoff(cands);
        cands = cands.filter(c => c.score >= cutoff);

        const hardCap = clamp(parseInt(S.targetTopN, 10) || 80, 10, 500) * 3;
        if (cands.length > hardCap) cands = cands.slice(0, hardCap);

        // 3. NOW apply the Blacklist/Whitelist filter (only reduces existing results)
        if (S.filterMode !== 'none' && filterFreqs.size > 0) {
            cands = cands.filter(c => {
                const freqNum = Math.round(c.tx.freq * 100);
                if (S.filterMode === 'whitelist') return filterFreqs.has(freqNum);
                if (S.filterMode === 'blacklist') return !filterFreqs.has(freqNum);
                return true;
            });
        }

        currentCands = cands;

        if (focusedCand && !cands.find(c => c.tx.id === focusedCand.tx.id && c.tx.freq === focusedCand.tx.freq)) {
            focusedCand = null;
        }

        renderMap();
        renderList();

        const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
        const cutoffStr = `${Math.round(cutoff)}%`;
        const rxTerrStr = fmtAlt(rxTerrainM || 0);
        const sunStr = `${Math.round(sunAltDeg)}°`;
        const rotorStr = (rotorAzDeg === null || rotorAzDeg === undefined) ? '—' : `${Math.round(rotorAzDeg)}°`;

        let showerStr = 'Sporadic (Background)';
        if (activeShower) {
            const p = activeShower.peak;
            showerStr = `${activeShower.name} (${activeShower.start.join('/')}–${activeShower.end.join('/')} peak ${p.join('/')})`;
        }

        if (statEl) {
            statEl.innerHTML = `
                <div style="display:flex; justify-content:space-between; width:100%; gap:10px; flex-wrap:wrap;">
                    <span><b>Time:</b> <span style="color:#fff;">${timeStr}</span> | <b>Hotspots:</b> <span style="color:#fff;">${currentCands.length}</span> | <b>Cutoff:</b> <span style="color:#ffaa00;">${cutoffStr}</span></span>
                    <span><b>RX Terrain:</b> <span style="color:#fff;">${rxTerrStr}</span> | <b>Sun Alt:</b> <span style="color:#fff;">${sunStr}</span> | <b>Rotor:</b> <span id="ms-rotor-val" style="color:#4aaeff;">${rotorStr}</span></span>
                    <span><b>Shower:</b> <span style="color:#fff;">${showerStr}</span></span>
                </div>
            `;
        }
    }

    function addDrag(el, handle){
        let ox, oy, sl, st;
        handle.onmousedown = e => {
            if(e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('a')) return;
            e.preventDefault(); ox=e.clientX; oy=e.clientY; sl=el.offsetLeft; st=el.offsetTop;
            document.onmousemove = me => {
                el.style.left = Math.max(0, Math.min(sl+me.clientX-ox, window.innerWidth -el.offsetWidth )) + 'px';
                el.style.top  = Math.max(0, Math.min(st+me.clientY-oy, window.innerHeight-el.offsetHeight)) + 'px';
            };
            document.onmouseup = () => {
                localStorage.setItem('ms_left', el.offsetLeft);
                localStorage.setItem('ms_top',  el.offsetTop);
                document.onmousemove = document.onmouseup = null;
            };
        };
    }

    function addDragWithPrefix(el, handle, prefix){
        let ox, oy, sl, st;
        handle.onmousedown = e => {
            if(e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('a')) return;
            e.preventDefault(); ox=e.clientX; oy=e.clientY; sl=el.offsetLeft; st=el.offsetTop;
            document.onmousemove = me => {
                el.style.left = Math.max(0, Math.min(sl+me.clientX-ox, window.innerWidth -el.offsetWidth )) + 'px';
                el.style.top  = Math.max(0, Math.min(st+me.clientY-oy, window.innerHeight-el.offsetHeight)) + 'px';
            };
            document.onmouseup = () => {
                localStorage.setItem(prefix+'_left', el.offsetLeft);
                localStorage.setItem(prefix+'_top',  el.offsetTop);
                document.onmousemove = document.onmouseup = null;
            };
        };
    }

    function addResize(wrapper){
        const resizer = document.getElementById('ms-resizer');
        if(!resizer) return;
        resizer.addEventListener('mousedown', e => {
            e.preventDefault();
            const sx=e.clientX, sy=e.clientY, sw=mapContainer.offsetWidth, sh=wrapper.offsetHeight;
            document.onmousemove = me => {
                const nw = Math.max(400, sw + me.clientX - sx);
                const nh = Math.max(400, sh + me.clientY - sy);
                const maxW = window.innerWidth - wrapper.offsetLeft - 340 - 20;
                const maxH = window.innerHeight - wrapper.offsetTop - 20;
                const finalW = Math.min(nw, maxW > 400 ? maxW : nw);
                const finalH = Math.min(nh, maxH > 400 ? maxH : nh);

                wrapper.style.width      = (finalW + 340) + 'px';
                mapContainer.style.width = finalW + 'px';
                wrapper.style.height     = finalH + 'px';
                document.getElementById('ms-list-panel').style.height = finalH + 'px';
                if(mapInstance) mapInstance.invalidateSize();
                resizeProfileCanvas(); redrawActiveProfile();
            };
            document.onmouseup = () => {
                localStorage.setItem('ms_width',  mapContainer.offsetWidth);
                localStorage.setItem('ms_height', wrapper.offsetHeight);
                document.onmousemove = document.onmouseup = null;
            };
        });
    }

    function initUI(rx) {
        if(document.getElementById('ms-wrapper')) return;

        let startWidth  = parseInt(localStorage.getItem('ms_width'))  || 820;
        let startHeight = parseInt(localStorage.getItem('ms_height')) || 640;
        let startLeft = parseInt(localStorage.getItem('ms_left'));
        let startTop  = parseInt(localStorage.getItem('ms_top'));
        
        if (isNaN(startLeft) || isNaN(startTop)) {
             startLeft = Math.max(0, (window.innerWidth - (startWidth + 340)) / 2);
             startTop  = Math.max(20, (window.innerHeight - startHeight) / 2);
        } else {
             if (startLeft < 0) startLeft = 0;
             if (startTop  < 0) startTop  = 0;
             if (startLeft > window.innerWidth  - 100) startLeft = window.innerWidth  - 400;
             if (startTop  > window.innerHeight - 100) startTop  = 20;
        }

        wrapper = document.createElement('div');
        wrapper.id = 'ms-wrapper';
        wrapper.style.cssText = `left:${startLeft}px;top:${startTop}px;width:${startWidth+340}px;height:${startHeight}px;`;

        let optionsHtml = `<option value="auto">Auto (Current Date)</option><option value="sporadic">Sporadic (Background)</option>`;
        METEOR_SHOWERS.forEach(s => { optionsHtml += `<option value="${s.id}">${s.name}</option>`; });

        wrapper.innerHTML = `
            <div id="ms-list-panel">
                <div id="ms-list-header">
                    <span><i class="fas fa-satellite-dish"></i> Scatter Candidates</span>
                </div>
                <div id="ms-list-body"></div>
            </div>

            <div id="ms-container">
                <div id="ms-header" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div style="font-weight:bold; white-space: nowrap; display:flex; align-items:center; gap:8px;">
                        <i class="fas fa-meteor" style="color:#4aaeff;"></i> Meteor Scatter
                    </div>
                    <select id="ms-shower-select">${optionsHtml}</select>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <a id="ms-help-btn" href="https://highpoint.fmdx.org/manuals/MeteorScatter-Documentation.html" target="_blank" title="Documentation">&#63;</a>
                        <button id="ms-settings-btn" title="Settings"><i class="fas fa-cog"></i></button>
                        <button id="ms-close" class="ms-sub-close" style="background:none;border:none;color:#fff;cursor:pointer;font-size:20px;padding:0 4px;line-height:1;">✕</button>
                    </div>
                </div>

                ${buildSettingsPanel()}
                <div id="ms-map">
                    <div id="ms-leaflet-wrap"></div>
                    <div id="ms-profile-panel">
                        <div class="ms-sub-header">
                            <div class="ms-sub-title" style="overflow: visible !important;">⛰️ Elevation Profile</div>
                            <button id="ms-profile-close" class="ms-sub-close" style="transform:translateX(340px);">✕</button>
                        </div>
                        <div style="position:relative;flex:1;width:100%;display:flex;">
                            <canvas id="ms-profile-canvas"></canvas>
                            <div id="ms-profile-y-zoom-container" title="Vertical Zoom (Double-click to reset)">
                                <input type="range" id="ms-profile-y-zoom" min="0.2" max="4.0" step="0.1" value="1.0">
                            </div>
                        </div>
                    </div>
                </div>
                <div id="ms-statusbar"><div id="ms-stat-msg" style="width:100%">Initialize...</div></div>
                <div id="ms-resizer"></div>
            </div>
        `;
        document.body.appendChild(wrapper);

        mapContainer = document.getElementById('ms-container');
        document.getElementById('ms-list-panel').style.height = startHeight + 'px';

        const settingsCloseBtn = document.getElementById('ms-settings-close');
        if (settingsCloseBtn) {
            settingsCloseBtn.style.position = 'static';
            settingsCloseBtn.style.margin = '0';
        }

        const settingsPanel = document.getElementById('ms-settings-panel');
        if (settingsPanel) {
            const settingsHeader = settingsPanel.querySelector('h5');
            settingsHeader.style.cursor = 'move';
            
            let setLeft = parseInt(localStorage.getItem('ms_set_left'));
            let setTop = parseInt(localStorage.getItem('ms_set_top'));
            if (!isNaN(setLeft) && !isNaN(setTop)) {
                settingsPanel.style.left = setLeft + 'px';
                settingsPanel.style.top = setTop + 'px';
                settingsPanel.style.right = 'auto'; 
            }
            
            addDragWithPrefix(settingsPanel, settingsHeader, 'ms_set');
        }
        
        initProfileCanvasEvents();
        initProfileCanvasHover();

        addDrag(wrapper, document.getElementById('ms-header'));
        addResize(wrapper);

        document.getElementById('ms-close').onclick = () => {
            mapActive = false;
            wrapper.remove();
            wrapper = null; mapContainer = null;
            document.getElementById('METEORSCATTER-on-off')?.classList.remove('active');
            window._msStopStream();
            applyRightAlign(false);
        };
        
        document.getElementById('ms-profile-close').onclick = () => {
            document.getElementById('ms-profile-panel').style.display = 'none';
            _activeProfileTxKey = null;
            _activeProfileTxObj = null;
            if(mapInstance) mapInstance.invalidateSize();
        };

        document.getElementById('ms-shower-select').onchange = (e) => {
            _selectedShowerId = e.target.value;
            focusedCand = null;
            updateData();
        };

        document.getElementById('ms-settings-btn').onclick = (e) => {
            e.stopPropagation();
            const panel = document.getElementById('ms-settings-panel');
            panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
        };

        if (settingsCloseBtn) {
            settingsCloseBtn.onclick = () => {
                document.getElementById('ms-settings-panel').style.display = 'none';
            };
        }

        document.getElementById('ms-settings-apply').onclick = () => {
            S.minDistKm = parseInt(document.getElementById('ms-s-min-dist').value);
            S.maxDistKm = parseInt(document.getElementById('ms-s-max-dist').value);
            S.minErpKw  = parseInt(document.getElementById('ms-s-min-erp').value);

            S.minScore = parseInt(document.getElementById('ms-s-min-score').value);
            S.strictMinScore = parseInt(document.getElementById('ms-s-strict-minscore').value) ? 1 : 0;
            S.filterMode = document.getElementById('ms-s-filter-mode').value;

            S.targetTopN = parseInt(document.getElementById('ms-s-topn').value);
            S.mapTopN = parseInt(document.getElementById('ms-s-maptopn').value);

            S.sunWeighting = parseInt(document.getElementById('ms-s-sun-weighting').value) ? 1 : 0;

            S.rxAglM = parseInt(document.getElementById('ms-s-rx-agl').value);
            S.txAglM = parseInt(document.getElementById('ms-s-tx-agl').value);

            S.groupCollapse = parseInt(document.getElementById('ms-s-group-collapse').value) ? 1 : 0;
            
            S.useMetric = document.getElementById('ms-s-metric').checked;
            S.autoRightAlign = document.getElementById('ms-s-rightalign').checked;

            localStorage.setItem('ms_min_dist', S.minDistKm);
            localStorage.setItem('ms_max_dist', S.maxDistKm);
            localStorage.setItem('ms_min_erp',  S.minErpKw);

            localStorage.setItem('ms_min_score', S.minScore);
            localStorage.setItem('ms_strict_minscore', S.strictMinScore);
            localStorage.setItem('ms_filter_mode', S.filterMode);

            localStorage.setItem('ms_target_topn', S.targetTopN);
            localStorage.setItem('ms_map_topn', S.mapTopN);

            localStorage.setItem('ms_sun_weighting', S.sunWeighting);

            localStorage.setItem('ms_rx_agl_m', S.rxAglM);
            localStorage.setItem('ms_tx_agl_m', S.txAglM);

            localStorage.setItem('ms_group_collapse', S.groupCollapse);
            
            localStorage.setItem('ms_use_metric', S.useMetric);
            localStorage.setItem('ms_auto_right_align', S.autoRightAlign);

            document.getElementById('ms-settings-panel').style.display = 'none';
            
            applyRightAlign(mapActive);

            txStations = [];
            focusedCand = null;
            rxTerrainM = null;
            updateData();
            
            if (_activeProfileTxKey) redrawActiveProfile();
        };

        document.getElementById('ms-settings-reset').onclick = () => {
            document.getElementById('ms-s-min-dist').value = 700;
            document.getElementById('ms-s-max-dist').value = 2200;
            document.getElementById('ms-s-min-erp').value  = 100;
            
            document.getElementById('ms-s-min-score').value = 50;
            document.getElementById('ms-s-strict-minscore').value = "0";
            document.getElementById('ms-s-filter-mode').value = "none";
            
            document.getElementById('ms-s-topn').value = 60;
            document.getElementById('ms-s-maptopn').value = 120;
            
            document.getElementById('ms-s-sun-weighting').value = "1";
            
            document.getElementById('ms-s-rx-agl').value = 10;
            document.getElementById('ms-s-tx-agl').value = 150;
            
            document.getElementById('ms-s-group-collapse').value = "1";
            
            document.getElementById('ms-s-metric').checked = true;
            document.getElementById('ms-s-rightalign').checked = false;
        };

        const mapDiv = document.getElementById('ms-leaflet-wrap');
        mapInstance = L.map(mapDiv, {zoomControl:true}).setView([rx.lat, rx.lon], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInstance);

        mapInstance.on('click', () => {
            if (focusedCand) {
                focusedCand = null;
                renderMap();
                renderList();
            }
        });

        const listPanel = document.getElementById('ms-list-panel');
        if (listPanel) {
            listPanel.addEventListener('click', (e) => {
                if (!e.target.closest('.ms-group')) {
                    if (focusedCand) {
                        focusedCand = null;
                        renderMap();
                        renderList();
                    }
                }
            });
        }

        lineLayer = L.layerGroup().addTo(mapInstance);
        hotspotLayer = L.layerGroup().addTo(mapInstance);
        txLayer = L.layerGroup().addTo(mapInstance);
        radiantLayer = L.layerGroup().addTo(mapInstance);
        rotorLayer = L.layerGroup().addTo(mapInstance);

        setTimeout(() => mapInstance.invalidateSize(), 200);

        connectDataPluginsWebSocket();
        
        applyRightAlign(true);

        updateData();
        setInterval(() => { if (mapActive) updateData(); }, 60000);
    }

    function ensureLeaflet(cb) {
        if (typeof L !== 'undefined') return cb();

        const lnk = document.createElement('link');
        lnk.rel = 'stylesheet';
        lnk.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(lnk);

        const scr = document.createElement('script');
        scr.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        scr.onload = cb;
        document.head.appendChild(scr);
    }

    function hookPluginButton() {
        let attempts = 0;
        const btnId = 'METEORSCATTER-on-off';

        loadCountryLookup().then(map => { ituToFlag = map; }).catch(() => { ituToFlag = {}; });

        const checkInterval = setInterval(() => {
            attempts++;
            const existingBtn = document.getElementById(btnId);

            if (existingBtn) {
                clearInterval(checkInterval);
                existingBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (mapActive) {
                        mapActive = false;
                        if(wrapper) { wrapper.remove(); wrapper=null; mapContainer=null; }
                        existingBtn.classList.remove('active');
                        window._msStopStream();
                        applyRightAlign(false);
                    } else {
                        const rx = getRxCoords();
                        if (!rx) return alert("No QTH configured!");
                        mapActive = true;
                        existingBtn.classList.add('active');
                        ensureLeaflet(() => initUI(rx));
                    }
                });

            } else if (typeof addIconToPluginPanel === 'function' && attempts > 4) {
                clearInterval(checkInterval);
                addIconToPluginPanel(btnId, 'Scatter', 'solid', 'meteor', `Meteor Scatter v${pluginVersion}`);

                setTimeout(() => {
                    document.getElementById(btnId)?.addEventListener('click', (e) => {
                        e.preventDefault();
                        if (mapActive) {
                            mapActive = false;
                            if(wrapper) { wrapper.remove(); wrapper=null; mapContainer=null; }
                            document.getElementById(btnId).classList.remove('active');
                            window._msStopStream();
                            applyRightAlign(false);
                        } else {
                            const rx = getRxCoords();
                            if (!rx) return alert("No QTH configured!");
                            mapActive = true;
                            document.getElementById(btnId).classList.add('active');
                            ensureLeaflet(() => initUI(rx));
                        }
                    });
                }, 100);
            }
        }, 100);
    }

    hookPluginButton();

})();