# Meteor Scatter Plugin
Predicts and visualizes optimal real-time hotspots for receiving distant FM radio signals reflected off ionized meteor trails by analyzing astronomical data, active meteor showers, and transmitter geometries.

<img width="520" height="310" alt="Screenshot 2026-04-17 120508" src="https://github.com/user-attachments/assets/1bf67823-6131-467a-be3d-1e5bdcd0b54f" />
<img width="450" height="400" alt="Screenshot 2026-04-17 120242" src="https://github.com/user-attachments/assets/4bd714dc-1b1f-46b0-bd62-0cbc993282f2" />

## Version 1.1 (Only compatible with FM DX Webserver version 1.4.0 and above !!!)

- Live Radar Model: Added server-side simulated radar data (via /api/meteorscatter/live_radar) that feeds dynamic scoring multipliers based on background bursts
- Antenna Beamwidth & Rotor Penalties: Hotspots outside the defined antenna beamwidth (when connected to a PST Rotator) receive massive scoring penalties. The beamwidth is visualized as a red cone overlay on the map
- Terrain Blocking Checks: Optional checking algorithm (3km and 10km path horizon checks) penalizes candidates that are physically obstructed by terrain
- Refined Shower Model: Gaussian modeling of the proximity to meteor shower peak dates and radiant elevation modeling (rewards mid-elevation alignments)

## Installation notes

1. [Download](https://github.com/Highpoint2000/MeteorScatter/releases) the last repository as a zip
2. Unpack all files from the folder to ..fm-dx-webserver-main\plugins\ 
3. Stop or close the fm-dx-webserver
4. Start/Restart the fm-dx-webserver with "npm run webserver" on node.js console, check the console informations
5. Activate the meteor scatter plugin in the settings
6. Stop or close the fm-dx-webserver
7. Start/Restart the fm-dx-webserver with "npm run webserver" on node.js console, check the console informations (for patching tx_search.js)
8. Stop or close the fm-dx-webserver
9. Start/Restart the fm-dx-webserver with "npm run webserver" on node.js console, check the console informations 
10. Reload the browser

NOTE: DON'T FORGET TO RESTART THE SERVER TWICE AFTER INSTALLING AND ACTIVATING THE PLUGIN!

## How to use
                                         
- For more details - please refer to the documentation: https://highpoint.fmdx.org/manuals/MeteorScatter-Documentation.html
- For equalizing/denoising the audio signals in scatter mode, the use of the AI ​​Denoiser is recommended: https://github.com/Highpoint2000/AI-Denoise
- To decode RDS as quickly as possible during short-term receptions, the use of the RDS AI decoder is recommended: https://github.com/Highpoint2000/RDS-AI-Decoder

## Blacklist and Whitelist Options

To exclude locally used frequencies, the plugin offers a blacklist and whitelist function. The required TXT files must be located in the plugin folder (sample files are included in the current plugin package). In the "whitelist.txt" file, you can store frequencies (e.g., 89.800, 89.400, 100.80) that should be considered exclusively during processing. In the "blacklist.txt" file, you define frequencies that should be excluded from processing. You can configure which filter list should be active in the plugin settings.

## Contact

If you have any questions, would like to report problems, or have suggestions for improvement, please feel free to contact me! You can reach me by email at highpoint2000@googlemail.com. I look forward to hearing from you!

<a href="https://www.buymeacoffee.com/Highpoint" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

<details>
<summary>History</summary>

### Version 1.0 (Only compatible with FM DX Webserver version 1.4.0 and above !!!)

- Meteor Scatter Prediction Engine: Core geometry and astronomy algorithms implemented for calculating optimal 95km reflection midpoints
- Shower Tracking: Automatic tracking of major annual meteor showers (Quadrantids, Lyrids, Eta Aquariids, Perseids, Orionids, Leonids, Geminids) with radiant-based forward scatter lines
- Diurnal & Sun Modeling: Scoring system accounts for Earth's leading edge and solar altitude
- Server-Side Caching: High-performance TX and Elevation database caching via meteorscatter_server.js
- Interactive UI: Live Leaflet map with hotspot markers, grouped list panel, and integrated audio streaming
- Frequency Filtering: Support for whitelist/blacklist to hide local splatter frequencies
