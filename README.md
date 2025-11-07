
# PPMChecker Plugin for BetterDiscord

**Author:** m0nkey.d.fluffy **Version:** 1.0.2

## Description

PPMChecker is an automation plugin for BetterDiscord designed to monitor a bot's status via the `/ppm` command. It runs a check every 15 minutes and performs automated recovery actions based on the bot's response.

-   **Automatic Check:** Every 15 minutes, the plugin automatically runs `/clear` and then `/ppm` in a specific channel.
    
-   **Smart Recovery:**
    
    -   If **PPM: 0** is detected, the plugin sends a `/stop` command, waits 6 minutes, then sends a `/start` command.
        
    -   If **"Cluster not started"** is detected (or the check times out), the plugin immediately sends a `/start` command.
        
    -   If **PPM > 0**, no action is taken.
        
-   **Notifications:** The plugin can send alert messages to a Discord channel of your choice to notify you of these recovery actions.
    

## Installation

1.  Download the `PPMChecker.plugin.js` file.
    
2.  Open your BetterDiscord plugins folder. You can find this in Discord by going to **User Settings > BetterDiscord > Plugins > Open Plugins Folder**.
    
3.  Drag the downloaded `PPMChecker.plugin.js` file into this folder.
    
4.  Return to Discord. If you don't see the plugin appear, press `Ctrl+R` to reload Discord.
    
5.  Find **PPMChecker** in your plugin list and enable it.
    

## Configuration (Required for Notifications)

This plugin uses a `PPMChecker.config.json` file for settings, which is more stable than an in-app menu.

### Step 1: Generate the Config File

When you enable **PPMChecker** for the first time, it will automatically create a file named `PPMChecker.config.json` in your BetterDiscord `plugins` folder.

### Step 2: Get Your Notification Channel ID

1.  In Discord, turn on **Developer Mode** (User Settings > Advanced > Developer Mode).
    
2.  Right-click on the text channel where you want to receive notifications (e.g., `#bot-status`). Note that this should be YOUR channel on your own private server; you don't want to be spamming public channels. 
    
3.  Click **"Copy Channel ID"**.
    

### Step 3: Edit the Config File

1.  Go to your `plugins` folder (the same place you put the plugin file).
    
2.  Open `PPMChecker.config.json` with any text editor (like Notepad).
    
3.  You will see:
    
    ```
    {
        "notificationChannelId": ""
        "sendClearCommand": true
    }  
    ```
    
4.  Paste your copied Channel ID inside the quotes:
    
    ```
    {
        "notificationChannelId": "1234567890123456789"
        "sendClearCommand": true
    }   
    ```
    
5.  **Optional:** If you do not want to run the /clear command, change the sendClearCommand flag to false. Do not use quotes.

6.  Save and close the file. 
    

### Step 4: Reload the Plugin

For the new settings to take effect, you must reload the plugin. The easiest way is to **toggle the PPMChecker plugin off and on again** in your BetterDiscord settings.

On this first run, the plugin will send a test message to your configured channel to confirm notifications are working.

## How to Use

### Automatic Mode (Default)

Once the plugin is enabled and configured, it runs entirely on its own. You do not need to do anything. It will perform the `/clear` and `/ppm` check every 30 minutes and log all its actions to your Discord console (press `Ctrl+Shift+I` to view it).

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
    
2.  **Config Loaded:** The plugin looks for `PPMChecker.config.json`.
    
    -   **If found:** It loads the `notificationChannelId`.
        
    -   **If not found:** It creates a new, blank `PPMChecker.config.json` for you to edit.
        
3.  **Logs Config Status:** It prints a pink message to your console telling you if the channel ID was loaded or if it's missing (disabling notifications).
    
4.  **Scheduler Started:** The plugin calls `runScheduler()` for the **first time** and then sets `setInterval` to call `runScheduler()` again every 15 minutes.
    

### 2. First Run: Module Loading

The very first time `runScheduler()` is called (immediately on plugin start), it performs a one-time setup:

1.  **Finds Command Executor:** It finds the internal Discord function for sending slash commands.
    
2.  **Patches Dispatcher:** It finds Discord's core Event Dispatcher and "patches" it to listen for `MESSAGE_CREATE` and `MESSAGE_UPDATE` events (which is how it sees the bot's hidden reply).
    
3.  **Finds Send Message:** It finds the simple, stable `sendMessage` function for sending notifications.
    
4.  **Sends Test Notification:** If a `notificationChannelId` is set, it immediately sends a test message to that channel to confirm the notification system is working.
    

### 3. The 15-Minute Loop (`runScheduler`)

This is the main loop that runs every 15 minutes (and also on the very first start).

-   **Step 1: Execute `/clear`**
    
    -   The plugin executes the `/clear` slash command in the target channel.
        
-   **Step 2: Wait**
    
    -   The plugin waits for **10 seconds**.
        
-   **Step 3: Execute `/ppm` & Start Listening**
    
    -   The plugin executes the `/ppm` slash command in the same channel.
        
    -   It simultaneously starts a **15-second timer** and prepares to "catch" the bot's response.
        

### 4. The Response: Four Possible Outcomes

During this 15-second window, the plugin's dispatcher patch is actively scanning all messages from the bot in that channel.

-   **✅ Case 1: Healthy (PPM > 0)**
    
    -   **Trigger:** The listener finds `PPM: [value]` (e.g., "PPM: 119") in the bot's message.
        
    -   **Action:** Logs a **GREEN** "✅ PPM Value CAPTURED" message to your console. The scheduler finishes, and the 15-minute timer for the _next_ run continues.
        
-   **❌ Case 2: Stalled (PPM = 0)**
    
    -   **Trigger:** The listener finds `PPM: 0` in the bot's message.
        
    -   **Action:**
        
        1.  Logs a **RED** "❌ PPM Value CAPTURED" message.
            
        2.  Sends a "⚠️ PPM value was 0..." alert to your notification channel.
            
        3.  Executes `/stop`.
            
        4.  Waits for **6 minutes**.
            
        5.  Executes `/start`.
            
        6.  The scheduler loop finishes.
            
-   **❌ Case 3: Offline ("Cluster not started")**
    
    -   **Trigger:** The listener finds the text `"Cluster not started"` in the bot's message.
        
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
