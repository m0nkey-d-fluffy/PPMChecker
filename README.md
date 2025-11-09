
# PPMChecker Plugin for BetterDiscord

**Author:** m0nkey.d.fluffy **Version:** 1.0.4

## Description

PPMChecker is an automation plugin for BetterDiscord designed to monitor a bot's status via the `/ppm` command. It runs a check every 15 minutes and performs automated recovery actions based on the bot's response.

-   **Automatic Check:** Every 15 minutes, the plugin automatically runs `/ppm` in a specific channel. It can also optionally run `/clear` first.
    
-   **Smart Recovery:**
    
    -   If **PPM: 0** is detected, the plugin sends a `/stop` command, waits 6 minutes, then sends a `/start` command.
        
    -   If **"Cluster not started"** is detected (or the check times out), the plugin immediately sends a `/start` command.
        
    -   If **PPM > 0**, no action is taken.
        
-   **Notifications:** The plugin sends alert messages to a Discord channel of your choice to notify you of recovery actions.
    
-   **Configurable:** All settings, including notification channel, /clear, and verbose logging, are now managed in the BetterDiscord plugin settings menu.
    

## Installation

1.  Download the `PPMChecker.plugin.js` file.
    
2.  Open your BetterDiscord plugins folder. You can find this in Discord by going to **User Settings > Plugins > Open Plugins Folder**.
    
3.  Drag the downloaded `PPMChecker.plugin.js` file into this folder.
    
4.  Return to Discord. If you don't see the plugin appear, press `Ctrl+R` to reload Discord.
    
5.  Find **PPMChecker** in your plugin list and enable it.
    

## Configuration

All settings are now managed inside the BetterDiscord settings panel. **The `PPMChecker.config.json` file is no longer used.**

1.  In Discord, go to **User Settings > Plugins**.
    
2.  Find **PPMChecker** in your plugin list and click the **Settings** button.
    
3.  Configure the options in the menu that appears.
    

### Settings Options

-   **Notification Channel ID**
    
    -   Paste the Channel ID where you want to receive alerts and logs.
        
    -   To get this, turn on **Developer Mode** (User Settings > Advanced > Developer Mode), then right-click your desired channel and select **"Copy Channel ID"**.
        
-   **Send /clear command** (Default: ON)
    
    -   When enabled, the plugin will execute the `/clear` command 10 seconds _before_ running the `/ppm` command.
        
    -   Toggle this OFF if you do not want the plugin to run `/clear`.
        
-   **Verbose Logging** (Default: OFF)
    
    -   When enabled, the plugin will send _all_ captured PPM responses (e.g., "✅ PPM Value: 120") to your notification channel.
        
    -   When disabled (default), the plugin will _only_ send alerts for critical events (0 PPM, cluster offline, or timeout).
        

On the first run after configuration, the plugin will send a test message to your configured channel to confirm notifications are working.

## How to Use

### Automatic Mode (Default)

Once the plugin is enabled and configured, it runs entirely on its own. You do not need to do anything. It will perform its check every 15 minutes and log all its actions to your Discord console (press `Ctrl+Shift+I` to view it).

### Manual Commands (For Testing)

You can manually trigger the plugin's functions from the Discord Console (`Ctrl+Shift+I` and go to the "Console" tab).

-   **Run the full check (clear, ppm, and recovery) immediately:**
    
    ```
    BdApi.Plugins.get("PPMChecker").instance.RunPPMCheck()
    ```
    
-   **Only send the `/start` command:**
    
    ```
    BdApi.Plugins.get("PPMChecker").instance.SendStartCommand()
    ```
    
-   **Only send the `/stop` command:**
    
    ```
    BdApi.Plugins.get("PPMChecker").instance.SendStopCommand()
    ```
    

## Full Workflow Breakdown

This is the complete logic the plugin follows.

### 1. Plugin Start

1.  **Name Set:** The plugin's name is internally set to `PPMChecker` for logging.
    
2.  **Settings Loaded:** The plugin loads its settings (Channel ID, sendClear, isVerbose) from BetterDiscord's internal storage.
    
3.  **Logs Settings Status:** It prints a pink message to your console detailing the loaded settings.
    
4.  **Scheduler Started:** The plugin calls `runScheduler()` for the **first time** and then sets `setInterval` to call `runScheduler()` again every 15 minutes.
    

### 2. First Run: Module Loading

The very first time `runScheduler()` is called (immediately on plugin start), it performs a one-time setup:

1.  **Finds Command Executor:** It finds the internal Discord function for sending slash commands.
    
2.  **Patches Dispatcher:** It finds Discord's core Event Dispatcher and "patches" it to listen for `MESSAGE_CREATE` and `MESSAGE_UPDATE` events (which is how it sees the bot's hidden reply).
    
3.  **Finds Send Message:** It finds the simple, stable `sendMessage` function for sending notifications.
    
4.  **Sends Test Notification:** If a `notificationChannelId` is set, it immediately sends a test message to that channel to confirm the notification system is working.
    

### 3. The 15-Minute Loop (`runScheduler`)

This is the main loop that runs every 15 minutes (and also on the very first start).

-   **Step 1: Check for `/clear`**
    
    -   If the **"Send /clear command"** setting is **ON**:
        
        -   The plugin executes the `/clear` slash command.
            
        -   It then waits for **10 seconds**.
            
    -   If the setting is **OFF**, this step is skipped entirely.
        
-   **Step 2: Execute `/ppm` & Start Listening**
    
    -   The plugin executes the `/ppm` slash command.
        
    -   It simultaneously starts a **15-second timer** and prepares to "catch" the bot's response.
        

### 4. The Response: Four Possible Outcomes

During this 15-second window, the plugin's dispatcher patch is actively scanning all messages from the bot in that channel.

-   **✅ Case 1: Healthy (PPM > 0)**
    
    -   **Trigger:** The listener finds `PPM: [value]` (e.g., "PPM: 119").
        
    -   **Action:**
        
        1.  Logs a **GREEN** "✅ PPM Value CAPTURED" message to your console.
            
        2.  If **"Verbose Logging"** is **ON**, it sends a "✅ PPM Value: 119" message to your notification channel.
            
        3.  The scheduler finishes.
            
-   **❌ Case 2: Stalled (PPM = 0)**
    
    -   **Trigger:** The listener finds `PPM: 0`.
        
    -   **Action:**
        
        1.  Logs a **RED** "❌ PPM Value CAPTURED" message to your console.
            
        2.  If **"Verbose Logging"** is **ON**, it sends a "❌ PPM Value: 0" message.
            
        3.  Sends a "⚠️ PPM value was 0..." alert to your notification channel (this sends regardless of verbose setting).
            
        4.  Executes `/stop`.
            
        5.  Waits for **6 minutes**.
            
        6.  Executes `/start`.
            
        7.  The scheduler loop finishes.
            
-   **❌ Case 3: Offline ("Cluster not started")**
    
    -   **Trigger:** The listener finds the text `"Cluster not started"`.
        
    -   **Action:**
        
        1.  Logs (pink) "Cluster Status CAPTURED... Initiating /start."
            
        2.  Sends a "❌ ...Cluster reported as "Cluster not started"..." alert to your notification channel.
            
        3.  Executes `/start` **immediately**.
            
        4.  The scheduler loop finishes.
            
-   **⏱️ Case 4: Timeout (No Response)**
    
    -   **Trigger:** The 15-second timer expires before any known message is captured.
        
    -   **Action:**
        
        1.  Logs (pink/error) "PPM check timed out... Initiating /start command."
            
        2.  Sends a "⏱️ ...PPM check timed out..." alert to your notification channel.
            
        3.  Executes `/start` **immediately**.
            
        4.  The scheduler loop finishes.
