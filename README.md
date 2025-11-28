# PPMChecker Plugin for BetterDiscord

**Author:** m0nkey.d.fluffy
**Version:** 1.0.10

## Description

PPMChecker is an automation plugin for BetterDiscord designed to monitor a user's cluster status via the `/ppm` command. It executes a check every 15 minutes, identifies the user's specific status from a list, and performs automated, verified recovery actions.

-   **Dynamic User Detection:** The plugin automatically identifies the current user's Discord ID and scans the bot's response to find their specific status, ignoring other members.
-   **Configurable Automation:** Automatically executes `/clear` (if enabled in settings) followed by `/ppm` in a 15-minute loop.
-   **Targeted Recovery:**
    -   Triggers a full restart sequence (`/stop` > 6 min wait > `/start`) if **Your PPM is 0**.
    -   Triggers a full restart sequence if the bot replies but **Your User ID is missing** from the list.
    -   Executes an immediate `/start` if the cluster is reported as **"Cluster not started"**.
-   **Group-Wide Monitoring (Helper Role):** If you have the @helper role, the plugin also monitors ALL users in the PPM response:
    -   Executes `/stop_cluster @user` if any other user has 0 PPM.
    -   Executes `/close_group <group-id>` (in English channel) if ALL users in the group have 0 PPM.
-   **Cooldown Detection & Auto-Retry:** Automatically detects bot cooldown messages (e.g., "You must wait 02:28 before starting again"), pauses for the required time plus a 10-second buffer, and automatically retries the `/start` command.
-   **Restart Verification:** After any recovery action, the plugin waits **2 minutes** for the cluster to warm up, performs a follow-up `/ppm` check, and sends a "Restart Successful" or "Restart FAILED" notification.
-   **Safe Timeout:** If the bot fails to respond to the `/ppm` command entirely (a true timeout), **no action is taken** to prevent restart loops caused by bot or API lag.
-   **Auto-Kick Detection & Auto-Rejoin:** Automatically detects when Dreama kicks you for reaching 99 friends, waits 5 minutes 10 seconds, and automatically rejoins by executing `/start`.

## Installation

1.  Download the `PPMChecker.plugin.js` file.
2.  Open your BetterDiscord plugins folder. (User Settings > Plugins > Open Plugins Folder).
3.  Drag the `PPMChecker.plugin.js` file into this folder.
4.  Return to Discord and reload (`Ctrl+R`) if the plugin does not appear.
5.  Locate **PPMChecker** in your plugin list and enable it.

## Configuration

All settings are managed via the BetterDiscord settings panel.

1.  In Discord, go to **User Settings > Plugins**.
2.  Find **PPMChecker** and click the **Settings** button.

### Settings Options

-   **Notification Channel ID**
    -   The Discord Channel ID to which all alerts and verbose logs will be sent.
    -   Enable **Developer Mode** (*User Settings > Advanced > Developer Mode*).
    -   Right-click the desired channel and select **"Copy Channel ID"**.
    
-   **Send /clear command** (Default: OFF)
    -   If enabled, the `/clear` command will be executed 10 seconds prior to the `/ppm` command.
    
-   **Verbose Logging** (Default: OFF)
    -   If enabled, all successful PPM checks (e.g., "✅ My PPM: 120") are sent to the notification channel.
    -   When disabled, only critical alerts (restarts, failures, errors) are sent.

A test message is sent to the configured channel on the plugin's first run to confirm notifications are working.

## How to Use

### Automatic Mode (Default)

Once enabled, the plugin operates autonomously. It identifies the user ID, runs checks every 15 minutes, and logs all actions to the Discord Console (`Ctrl+Shift+I`).

### Manual Commands (For Testing)

Trigger plugin functions directly from the Discord Console.

-   **Run the full check and recovery sequence:**
    ```javascript
    BdApi.Plugins.get("PPMChecker").instance.RunPPMCheck()
    ```
-   **Manually send the `/start` command:**
    ```javascript
    BdApi.Plugins.get("PPMChecker").instance.SendStartCommand()
    ```
-   **Manually send the `/stop` command:**
    ```javascript
    BdApi.Plugins.get("PPMChecker").instance.SendStopCommand()
    ```

## Full Workflow Breakdown

This is the complete logic sequence for v1.0.10.

### 1. Plugin Start
1.  **Identity Check:** The plugin loads the current user's Discord ID.
2.  **Scheduler Start:** The 15-minute `runScheduler` interval is started.
3.  **Module Load:** On the first run, it loads all necessary internal Discord modules.

### 2. The 15-Minute Loop (`runScheduler`)
1.  **Execute `/clear`:** If the "Send /clear command" setting is enabled, `/clear` is executed. The plugin then waits 10 seconds.
2.  **Execute `/ppm`:** The `/ppm` command is executed.
3.  **Start Listener:** The plugin begins listening for a response from the bot, with a **15-second timeout**.

### 3. The Response: Five Possible Outcomes

-   **✅ Case 1: Healthy (My PPM > 0)**
    -   **Trigger:** The plugin finds your User ID in the response with a PPM value greater than 0.
    -   **Action:** The sequence ends. No recovery is needed.

-   **❌ Case 2: Stalled (My PPM = 0)**
    -   **Trigger:** The plugin finds your User ID, but the value is `🎁 **0**`.
    -   **Action:**
        1.  A "⚠️ YOUR PPM is 0" alert is sent.
        2.  Executes `/stop`.
        3.  Waits for **6 minutes**.
        4.  Executes `/start` **with cooldown detection**.
        5.  Triggers **Restart Verification**.

-   **❌ Case 3: Offline ("Cluster not started")**
    -   **Trigger:** The bot's response contains the text "Cluster not started".
    -   **Action:**
        1.  A "❌ Cluster 'Not Started'" alert is sent.
        2.  Executes `/start` **immediately with cooldown detection**.
        3.  Triggers **Restart Verification**.

-   **❓ Case 4: User Missing (Bot Replied)**
    -   **Trigger:** The 15-second timer expires, but the plugin *did* see a message from the bot (meaning your ID was not in the list).
    -   **Action:**
        1.  A "❓ Your ID was not found" alert is sent.
        2.  Executes `/stop`.
        3.  Waits for **6 minutes**.
        4.  Executes `/start` **with cooldown detection**.
        5.  Triggers **Restart Verification**.

-   **⏱️ Case 5: Timeout (No Bot Response)**
    -   **Trigger:** The 15-second timer expires, and the plugin *did not* see any message from the bot.
    -   **Action:**
        1.  **No action is taken.** The plugin logs a "Bot did not reply" warning.
        2.  This prevents restart loops if the bot is lagging or offline. The plugin will simply try again on the next 15-minute cycle.

### 4. Cooldown Detection & Handling
-   When executing the `/start` command, the plugin:
    1.  Sends the `/start` command to the bot.
    2.  Waits up to **10 seconds** for a bot response.
    3.  **If cooldown detected:**
        -   Parses the cooldown message (e.g., "You must wait 02:28 before starting again").
        -   Calculates total wait time = cooldown time + **10 second buffer**.
        -   Sends a "⏳ **Cooldown Detected**" notification with the wait time.
        -   Waits for the full duration.
        -   Automatically retries the `/start` command.
    4.  **If successful:** Proceeds normally with restart verification.
    5.  **If timeout:** Assumes success and continues (bot may have accepted the command without responding).

### 5. Restart Verification
-   After any restart action (Cases 2, 3, or 4), the plugin:
    1.  Waits **2 minutes** for the cluster to warm up.
    2.  Executes `/ppm` one more time.
    3.  Checks the result.
    4.  Sends a "✅ **Restart Successful**" or "🚨 **Restart FAILED**" notification based on the outcome of this final check.

### 6. Group-Wide Monitoring (Helper Role Only)
-   **Prerequisite:** The user must have the @helper role assigned in Discord.
-   **When it runs:** After each `/ppm` check, if you have the helper role, the plugin scans ALL users in the response.
-   **Actions:**
    -   **Individual User at 0 PPM:**
        -   If any other user (not yourself) has 0 PPM, the plugin sends a "🔧 **Group Member Down**" alert.
        -   Executes `/stop_cluster @user` to restart that specific user's cluster.
    -   **Entire Group at 0 PPM:**
        -   If ALL users in the group (including yourself) have 0 PPM, the plugin sends a "🚨 **Entire Group Down**" alert.
        -   Executes `/close_group <group-id>` in the **English channel** where most helpers operate and help is requested.
-   **Self-Management Priority:** The plugin always handles your own 0 PPM situation with `/stop` first, then checks other users.
-   **Channel Routing:** `/close_group` executes in the English channel since it publicly pings all users in the group and that's where most helpers and help requests are located.

### 7. Auto-Kick Detection & Auto-Rejoin
-   **Trigger:** Dreama bot sends a DM with "Auto Kick" title when you reach 99 friends.
-   **Action:**
    1.  Plugin detects the auto-kick DM embed.
    2.  Sends a "🚨 **Auto Kick Detected**" notification.
    3.  Waits **5 minutes 10 seconds** (310 seconds).
    4.  Automatically executes `/start` to rejoin the group with cooldown handling.
    5.  Sends a "⏰ **Auto-Rejoining**" notification when executing the rejoin.