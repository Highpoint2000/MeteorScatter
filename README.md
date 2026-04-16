# Meteor Scatter Plugin
Predicts and visualizes real-time airplane scatter opportunities for FM radio reception by combining live ADS-B flight tracking with transmitter databases and elevation profiles.

<img width="500" height="300" alt="Screenshot 2026-04-16 234152" src="https://github.com/user-attachments/assets/709184a7-ff14-455d-96ad-f01c344abf55" />
<img width="450" height="400" alt="Screenshot 2026-04-16 234427" src="https://github.com/user-attachments/assets/c6a0d61d-2bea-4bca-a7f3-54244530cdc7" />



## Version 1.0 (Only compatible with FM DX Webserver version 1.4.0 and above !!!)

- Meteor Scatter Prediction Engine: Core geometry and astronomy algorithms implemented for calculating optimal 95km reflection midpoints
- Shower Tracking: Automatic tracking of major annual meteor showers (Quadrantids, Lyrids, Eta Aquariids, Perseids, Orionids, Leonids, Geminids) with radiant-based forward scatter lines
- Diurnal & Sun Modeling: Scoring system accounts for Earth's leading edge and solar altitude
- Server-Side Caching: High-performance TX and Elevation database caching via meteorscatter_server.js
- Interactive UI: Live Leaflet map with hotspot markers, grouped list panel, and integrated audio streaming
- Frequency Filtering: Support for whitelist/blacklist to hide local splatter frequencies

## Installation notes

1. [Download](https://github.com/Highpoint2000/MeteorScatter/releases) the last repository as a zip
2. Unpack all files from the folder to ..fm-dx-webserver-main\plugins\ 
3. Stop or close the fm-dx-webserver
4. Start/Restart the fm-dx-webserver with "npm run webserver" on node.js console, check the console informations
5. Activate the sysinfo plugin in the settings
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

