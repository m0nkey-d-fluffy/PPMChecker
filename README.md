# PPMChecker Plugin for BetterDiscord

**Author:** m0nkey.d.fluffy  
**Version:** 1.0.5

## Description

PPMChecker is an automation plugin for BetterDiscord designed to monitor your personal status within a bot's cluster via the `/ppm` command. It runs a check every 15 minutes and performs automated recovery actions based on your specific status.

-   **Dynamic User Detection:** The plugin automatically identifies your Discord User ID and scans the bot's response list specifically for **your** name/ID. It ignores the status of other members in the group.
-   **Automatic Check:** Every 15 minutes, the plugin automatically runs `/ppm` in a specific channel.
-   **Smart Recovery:**
    -   If **Your PPM is 0**: The plugin sends a `/stop` command, waits 6 minutes, then sends a `/start` command.
    -   If **"Cluster not started"** is detected: The plugin immediately sends a `/start` command.
    -   If **Your PPM > 0**: The cluster is healthy; no action is taken.
    -   **Safety Mode:** If the check times out or your User ID is not found in the list, **no action is taken** (to prevent accidental restarts).
-   **Notifications:** The plugin sends alert messages to a Discord channel of your choice to notify you of recovery actions.
-   **Configurable:** Settings for notifications and logging are managed in the BetterDiscord plugin settings menu.

## Installation

1.  Download the `PPMChecker.plugin.js` file.
2.  Open your BetterDiscord plugins folder. You can find this in Discord by going to **User Settings > Plugins > Open Plugins Folder**.
3.  Drag the downloaded `PPMChecker.plugin.js` file into this folder.
4.  Return to Discord. If you don't see the plugin appear, press `Ctrl+R` to reload Discord.
5.  Find **PPMChecker** in your plugin list and enable it.

## Configuration

All settings are managed inside the BetterDiscord settings panel.

1.  In Discord, go to **User Settings > Plugins**.
2.  Find **PPMChecker** in your plugin list and click the **Settings** button.
3.  Configure the options below:

### Settings Options

-   **Notification Channel ID**
    -   Paste the Channel ID where you want to receive alerts and logs.
    -   To get this, turn on **Developer Mode** (*User Settings > Advanced > Developer Mode*), then right-click your desired channel and select **"Copy Channel ID"**.
    
-   **Send /clear command**
    -   *Note: In v1.0.5, this logic is currently disabled in the code regardless of the toggle setting.*
    
-   **Verbose Logging** (Default: OFF)
    -   When enabled, the plugin will send *all* captured PPM responses (e.g., "✅ My PPM: 120") to your notification channel.
    -   When disabled (default), the plugin will *only* send alerts for critical events (0 PPM, cluster offline, or errors).

On the first run after configuration, the plugin will send a test message to your configured channel to confirm notifications are working.

## How to Use

### Automatic Mode (Default)

Once enabled, the plugin runs automatically. It will:
1.  Identify your User ID.
2.  Run the check every 15 minutes.
3.  Log actions to the Discord Console (`Ctrl+Shift+I`).

### Manual Commands (For Testing)

You can manually trigger the plugin's functions from the Discord Console (`Ctrl+Shift+I` > "Console" tab).

-   **Run the full check immediately:**
    ```javascript
    BdApi.Plugins.get("PPMChecker").instance.RunPPMCheck()
    ```
-   **Only send the `/start` command:**
    ```javascript
    BdApi.Plugins.get("PPMChecker").instance.SendStartCommand()
    ```
-   **Only send the `/stop` command:**
    ```javascript
    BdApi.Plugins.get("PPMChecker").instance.SendStopCommand()
    ```

## Full Workflow Breakdown

This is the complete logic the plugin follows in v1.0.5:

### 1. Plugin Start
1.  **Identity Check:** The plugin loads your Discord User ID so it knows who to look for.
2.  **Scheduler:** Starts the 15-minute interval loop.

### 2. The 15-Minute Loop
1.  The plugin executes the `/ppm` slash command.
2.  It starts a **15-second timer** to catch the bot's response.

### 3. The Response Logic
The plugin scans the bot's Rich Embed response using a targeted Regex that looks for: `<@YOUR_ID> ... 🎁 **VALUE**`.

-   **✅ Case 1: Healthy (My PPM > 0)**
    -   **Trigger:** Your specific line shows a value greater than 0.
    -   **Action:** No recovery needed. Logs "✅ Found My PPM" to console.

-   **❌ Case 2: Stalled (My PPM = 0)**
    -   **Trigger:** Your specific line shows `🎁 **0**`.
    -   **Action:**
        1.  Sends a "⚠️ PPM value was 0..." alert to your notification channel.
        2.  Executes `/stop`.
        3.  Waits for **6 minutes**.
        4.  Executes `/start`.

-   **❌ Case 3: Offline ("Cluster not started")**
    -   **Trigger:** The bot replies with text containing "Cluster not started".
    -   **Action:**
        1.  Sends a "❌ Cluster reported as 'Not Started'..." alert.
        2.  Executes `/start` **immediately**.

-   **❓ Case 4: Timeout / User Not Found (Safety Mode)**
    -   **Trigger:** The 15-second timer expires, or the bot replies but your User ID is not in the list.
    -   **Action:**
        1.  Sends a warning notification.
        2.  **Takes NO action.** (The plugin will not blindly restart the cluster if it can't confirm your status, preventing false restarts).