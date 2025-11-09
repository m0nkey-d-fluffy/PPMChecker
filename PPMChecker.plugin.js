/**
 * @name PPMChecker
 * @author m0nkey.d.fluffy
 * @description Automatically runs /clear then /ppm every 15 mins, monitors the response, and restarts the cluster if PPM is 0.
 * @version 1.0.3
 * @source https://github.com/m0nkey-d-fluffy/PPMChecker
 */

/*@cc_on
@if (@_jscript)
    // Boilerplate for self-installation
    var shell = WScript.CreateObject("WScript.Shell");
    var fs = new ActiveXObject("Scripting.FileSystemObject");
    var pathPlugins = shell.ExpandEnvironmentStrings("%APPDATA%\\BetterDiscord\\plugins");
    var pathSelf = WScript.ScriptFullName;
    shell.Popup("It looks like you've mistakenly tried to run me directly. \n(Don't do that!) \n\nI'm a plugin for BetterDiscord, you need to \nput me in your plugins folder: \n" + pathPlugins + "\n\nPress OK to copy myself to that folder.", 0, "I'm a Plugin!", 0x30);
    if (fs.GetParentFolderName(pathSelf) === fs.GetParentFolderName(pathPlugins)) {
        shell.Popup("I'm already in your plugins folder... \nJust reload Discord instead.", 0, "I'm already there!", 0x40);
    } else if (!fs.FolderExists(pathPlugins)) {
        shell.Popup("I can't find the BetterDiscord plugins folder.\nAre you sure it's installed?", 0, "Can't Find Folder", 0x10);
    } else if (fs.FileExists(pathPlugins + "\\PPMChecker.plugin.js")) {
        shell.Popup("I'm already there. I'll add a .1 to my name, but you should remove the duplicate.", 0, "I'm already there!", 0x40);
        fs.CopyFile(pathSelf, pathPlugins + "\\PPMChecker.plugin.js.1");
    } else {
        fs.CopyFile(pathSelf, pathPlugins + "\\PPMChecker.plugin.js");
        shell.Run("explorer.exe /select," + pathPlugins + "\\PPMChecker.plugin.js");
    }
@else@*/

function PPMChecker(meta) {

    // --- NODE.JS MODULES ---
    // Node.js modules provided by the BetterDiscord environment
    const fs = require("fs");
    const path = require("path");

    // --- CONFIGURATION: Core IDs and Timing ---
    const CONFIG = {
        CHANNEL_ID: "1343184699018842202",
        GUILD_ID: "1334603881652555896",
        BOT_APPLICATION_ID: "1334630845574676520", 
        INTERVAL_MS: 15 * 60 * 1000,         // 15 minutes for scheduling
        CLEAR_DELAY_MS: 10 * 1000,           // 10 seconds delay between /clear and /ppm
        RELOAD_DELAY_MS: 6 * 60 * 1000,      // 6 minutes delay between /stop and /start
        PPM_TIMEOUT_MS: 15 * 1000            // 15 seconds max wait for PPM response
    };

    // --- STATUS CONSTANTS ---
    const CLUSTER_OFFLINE_STRING = "Cluster not started";
    const CLUSTER_OFFLINE_MARKER = "CLUSTER_OFFLINE_MARKER";

    // --- COMMAND DATA: Extracted from V17 Payloads ---
    
    const CLEAR_COMMAND = {
        name: "clear",
        commandId: "1416039398792888330",
        commandVersion: "1433501849713115315",
        description: "Clear your friends list (Keep your GP friends and Favs)",
        rank: 3,
        options: [ // Command options
            {
                "type": 5,
                "name": "force-remove-all",
                "description": "If true, removes all friends - keep only favs",
                "required": false
            }
        ]
    };

    const PPM_COMMAND = {
        name: "ppm",
        commandId: "1414334983707033774",
        commandVersion: "1414334983707033780",
        description: "Check your current PackPerMinute",
        rank: 1,
        options: []
    };
    
    const STOP_COMMAND = {
        name: "stop",
        commandId: "1414334983707033773",
        commandVersion: "1414334983707033779",
        description: "Stop your cluster",
        rank: 4,
        options: []
    };

    const START_COMMAND = {
        name: "start",
        commandId: "1414334983707033772",
        commandVersion: "1414334983707033778",
        description: "Start your cluster",
        rank: 2,
        options: []
    };

    // Internal state
    let interval = null;
    let _executeCommand = null;
    let _dispatcher = null; 
    let _sendMessage = null; // For sending notifications
    let _modulesLoaded = false;
    let _ppmResolve = null; // Function to resolve the current PPM check Promise

    // --- SETTINGS MANAGEMENT (via config.json) ---
    const configPath = path.join(BdApi.Plugins.folder, "PPMChecker.config.json");
    const defaultSettings = {
        notificationChannelId: "", // Channel ID to forward matching messages to.
        sendClearCommand: true     // Whether to run /clear before /ppm
    };
    let currentSettings = { ...defaultSettings };

    const loadConfig = () => {
        if (!fs.existsSync(configPath)) {
            log(`Config file not found, creating one at: ${configPath}`, "warn");
            try {
                fs.writeFileSync(configPath, JSON.stringify(defaultSettings, null, 4));
            } catch (e) {
                log(`Failed to create config file: ${e.message}`, "error");
            }
            currentSettings = { ...defaultSettings };
        } else {
            try {
                const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
                // Ensure all default keys are present
                currentSettings = { ...defaultSettings, ...configData };
                log("Config file loaded successfully.", "info");
            } catch (e) {
                log(`Failed to read or parse config file: ${e.message}`, "error");
                currentSettings = { ...defaultSettings };
            }
        }
    };


    // --- UTILITIES ---

    /** A helper to safely log messages with custom styling. */
    const log = (message, type = "info") => {
        try {
            const method = console[type] && typeof console[type] === 'function' ? console[type] : console.log;
            
            if (type === 'info' || type === 'warn' || type === 'error' || type === 'fatal') {
                // Apply pink highlight for notice-level logs
                method(`%c[${meta.name}]%c ${message}`, "color: #FF69B4; font-weight: bold;", "color: unset; font-weight: unset;");
            } else {
                 method(`[${meta.name}] ${message}`);
            }
        } catch (e) {
            console.log(`[${meta.name} | Fallback Log] ${message}`);
        }
    };

    /** A helper to show a toast notification. */
    const showToast = (message, type = "info") => {
        if (window.BdApi && BdApi.showToast) BdApi.showToast(message, { type });
        else log(`TOAST: ${message}`, type);
    };

    /** A helper to create a delay. */
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    /**
     * Sends a plain text message notification to the configured channel.
     * @param {string} message The message content.
     */
    const sendRestartNotification = (message) => {
        // [FIX] Reverted to stable, simple checks.
        if (!_sendMessage || !currentSettings.notificationChannelId) {
            log("Cannot send notification: Send Message module unavailable or Notification Channel ID not set.", "warn");
            return;
        }
        
        try {
            // [FIX] Use the simple, stable message object
            const messageData = { 
                content: message, 
                tts: false,
                invalidEmojis: [],
                validNonShortcutEmojis: []
            };
            
            // [FIX] Use the 4-argument call signature
            _sendMessage(currentSettings.notificationChannelId, messageData, undefined, {});
            log(`Sent restart notification to channel ${currentSettings.notificationChannelId}.`, "info");
        } catch (error) {
            log(`Error sending notification: ${error.message}`, "error");
        }
    };


    // --- MESSAGE LISTENER LOGIC (Integrated into Dispatcher) ---

    /**
     * Searches message content and embeds for the PPM value or critical status messages.
     * @param {object} message The message object from the dispatcher.
     */
    const capturePPMValue = (message) => {
        if (!_ppmResolve) return; // No active PPM check pending

        // Regex to find "PPM:" followed by optional whitespace and a number (including decimals).
        const ppmRegex = /PPM:\s*(\d+(\.\d+)?)/i; 

        const searchAndResolve = (text, source) => {
            if (!text) return false;
            
            // 1. Check for critical offline message
            if (text.includes(CLUSTER_OFFLINE_STRING)) {
                log(`Cluster Status CAPTURED (${source}): "${CLUSTER_OFFLINE_STRING}". Initiating /start.`, "warn");
                _ppmResolve(CLUSTER_OFFLINE_MARKER); // Resolve promise with offline marker
                _ppmResolve = null; 
                return true;
            }

            // 2. Check for PPM value
            const match = text.match(ppmRegex);
            if (match) {
                const capturedValue = parseFloat(match[1]);

                // Conditional logging based on value
                const color = capturedValue > 0 ? "#4CAF50" : "#FF0000";
                const icon = capturedValue > 0 ? "✅" : "❌";

                // Use direct console.log with styling for reliability in patcher
                console.log(`%c[${meta.name}]%c ${icon} PPM Value CAPTURED (%c${source}%c): ${match[0]}`, 
                    `color: ${color}; font-weight: bold;`, 
                    "color: unset; font-weight: unset;",
                    "color: #1a73e8; font-weight: bold;",
                    "color: unset; font-weight: unset;"
                );
                
                // Resolve the promise with the numerical value
                _ppmResolve(capturedValue);
                _ppmResolve = null; // Clear the resolver to prevent multiple triggers
                return true;
            }
            return false;
        };

        // Check message.content
        if (searchAndResolve(message.content, "Content")) return;
        
        // Check embeds
        if (message.embeds && message.embeds.length > 0) {
            for (const embed of message.embeds) {
                // Check description
                if (searchAndResolve(embed.description, "Embed Description")) return;

                // Check fields (Name and Value)
                if (embed.fields && embed.fields.length > 0) {
                    for (const field of embed.fields) {
                        if (searchAndResolve(field.name, "Embed Field Name")) return;
                        if (searchAndResolve(field.value, "Embed Field Value")) return;
                    }
                }
            }
        }
    };

    /**
     * Creates a promise that resolves when PPM value is captured or times out.
     * @returns {Promise<number|string>} PPM value, "TIMEOUT", or CLUSTER_OFFLINE_MARKER
     */
    const waitForPPMResult = () => {
        if (_ppmResolve) {
            // A check is already pending. Prevent race condition.
            return Promise.resolve("RACE_CONDITION");
        }
        
        return new Promise(resolve => {
            _ppmResolve = resolve;
            
            // Set up a timeout to handle cases where the bot doesn't respond
            setTimeout(() => {
                if (_ppmResolve) {
                    _ppmResolve("TIMEOUT");
                    _ppmResolve = null; // Clear the resolver on timeout
                }
            }, CONFIG.PPM_TIMEOUT_MS);
        });
    };

    /**
     * Finds and binds the internal Discord function for executing slash commands.
     */
    const loadCommandExecutor = async () => { 
        try {
            log("Attempting to find Command Executor module...");
            const moduleFilter = (m) => {
                const target = m.default ? m.default : m;
                if (!target || typeof target !== 'object') return false;
                return Object.keys(target).some(k => {
                    try {
                        const funcString = target[k].toString().toLowerCase();
                        return typeof target[k] === 'function' &&
                            funcString.includes("commandorigin") &&
                            funcString.includes("optionvalues");
                    } catch (e) { return false; }
                });
            };

            const keyFinder = (target, k) => {
                try {
                    const funcString = target[k].toString().toLowerCase();
                    return typeof target[k] === 'function' &&
                        funcString.includes("commandorigin") &&
                        funcString.includes("optionvalues");
                } catch (e) { return false; }
            };

            const mod = await BdApi.Webpack.waitForModule(moduleFilter, { first: true });
            if (!mod) throw new Error("Module filter failed to find anything.");
            
            const target = mod.default ? mod.default : mod;
            const funcKey = Object.getOwnPropertyNames(target).find(k => keyFinder(target, k));

            if (funcKey && typeof target[funcKey] === 'function') {
                log(`SUCCESS: Found Command Executor function: '${funcKey}'`);
                return target[funcKey].bind(target);
            } else {
                throw new Error("Found module, but could not locate the execution function inside.");
            }
        } catch (e) {
            log(`Fatal Error loading Command Executor: ${e.message}`, "error");
            return null;
        }
    };
    
    /**
     * Finds and patches the Discord Event Dispatcher (Webpack search only).
     */
    const loadDispatcherPatch = async () => { 
        try {
            log("Attempting to find Discord Event Dispatcher module...");
            
            let dispatchModule = null;
            
            // Webpack Search
            let mod = BdApi.Webpack.getModule(m => m.dispatch && m._events, { searchExports: true });
            if (!mod) mod = BdApi.Webpack.getModule(BdApi.Webpack.Filters.byProps("subscribe", "unsubscribe", "dispatch"));
            dispatchModule = mod.dispatch ? mod : (mod.default ? mod.default : mod);

            if (!dispatchModule || typeof dispatchModule.dispatch !== 'function') {
                throw new Error("Could not locate a usable Dispatcher module.");
            }
            
            _dispatcher = dispatchModule;
            
            // Patch the core dispatch function to intercept events
            BdApi.Patcher.after(meta.name, _dispatcher, "dispatch", (_, args) => {
                const event = args[0]; // The first argument is the event object

                // Filter for MESSAGE_CREATE or MESSAGE_UPDATE events
                if (event.type === 'MESSAGE_CREATE' || event.type === 'MESSAGE_UPDATE') {
                    // MESSAGE_CREATE uses 'message', MESSAGE_UPDATE sometimes uses 'data'
                    const message = event.message || event.data; 

                    // Filter 1: Ensure the message is in our target channel
                    if (message && message.channel_id === CONFIG.CHANNEL_ID) {
                        
                        // Filter 2: Ensure the message is from the correct bot ID
                        if (message.author?.id === CONFIG.BOT_APPLICATION_ID) {
                            capturePPMValue(message);
                        }
                    }
                }
            });
            
            log(`SUCCESS: Patched Discord Dispatcher to listen for MESSAGE_CREATE/UPDATE from the bot.`, "info");
            
        } catch (error) {
            log(`Failed to patch Event Dispatcher (Critical): ${error.message}`, "error");
        }
    };
    
    /**
     * [FIX] Finds Discord's simple internal sendMessage function.
     */
    const loadSendMessageModule = async () => {
        try {
            log("Attempting to find Send Message module (legacy)...");
            // [FIX] Use a simple, stable filter
            const mod = await BdApi.Webpack.waitForModule(BdApi.Webpack.Filters.byProps("sendMessage", "receiveMessage"));
            
            _sendMessage = mod.sendMessage;
            if (!_sendMessage) throw new Error("Could not find sendMessage function.");
            
            log(`SUCCESS: Found simple Send Message module.`, "info");

        } catch (error) {
            log(`Failed to load Send Message module: ${error.message}`, "error");
            _sendMessage = null;
        }
    };

    /**
     * [REMOVED] loadNonceGenerator
     */

    /**
     * Orchestrates loading all modules.
     * @returns {Promise<boolean>} True if the critical module was successful.
     */
    const loadModules = async () => {
        // 1. CRITICAL: Load command executor
        _executeCommand = await loadCommandExecutor();
        if (!_executeCommand) {
            log("Critical Command Executor failed to load. Plugin cannot run commands.", "fatal");
            return false;
        }

        // 2. OPTIONAL: Load Dispatcher Patch
        await loadDispatcherPatch();

        // 3. OPTIONAL: Load Send Message module
        await loadSendMessageModule();
        
        // 4. [REMOVED] Nonce generator loader

        return true;
    };


    // --- EXECUTION LOGIC ---

    /**
     * Executes a slash command using the internal Discord API function.
     * @param {object} command The command object.
     * @param {object} [optionValues={}] Key/value pairs for options
     */
    const executeSlashCommand = async (command, optionValues = {}) => {
        if (!_executeCommand) {
            log("Command Executor module is not loaded. Cannot execute command.", "error");
            return;
        }

        const name = command.name;
        log(`Attempting to execute SLIDE COMMAND: "/${name}" to channel ID ${CONFIG.CHANNEL_ID}`, "info");

        try {
            // Rebuild the required command/context objects
            const realCommand = {
                id: command.commandId,
                version: command.commandVersion,
                type: 1, // CHAT_INPUT
                inputType: 3, // CHAT
                name: name,
                applicationId: CONFIG.BOT_APPLICATION_ID,
                options: command.options || [], // Use command's defined options
                dmPermission: true,
                integration_types: [0, 1],
                displayDescription: command.description,
                displayName: name,
                untranslatedName: name,
                serverLocalizedName: name,
                untranslatedDescription: command.description,
                global_popularity_rank: command.rank,
                rootCommand: {
                    id: command.commandId,
                    type: 1,
                    application_id: CONFIG.BOT_APPLICATION_ID,
                    version: command.commandVersion,
                    name: name,
                    description: command.description,
                    dm_permission: true,
                    integration_types: [0, 1],
                    global_popularity_rank: command.rank,
                    options: command.options || [],
                    description_localized: command.description,
                    name_localized: name
                },
                section: {
                    type: 1,
                    id: CONFIG.BOT_APPLICATION_ID,
                    name: "Dreama",
                    icon: "17d39a9b7ea9ce8ed69a57eb99f6f37f",
                    botId: CONFIG.BOT_APPLICATION_ID,
                    isUserApp: false,
                    application: {
                        description: "",
                        icon: "17d39a9b7ea9ce8ed69a57eb99f6f37f",
                        id: CONFIG.BOT_APPLICATION_ID,
                        name: "Drenass",
                        bot: {
                            id: CONFIG.BOT_APPLICATION_ID,
                            username: "Dreama",
                            discriminator: "5958",
                            avatar: "17d39a9b7ea9ce8ed69a57eb99f6f37f",
                            bot: true,
                        }
                    }
                }
            };

            const mockChannel = {
                id: CONFIG.CHANNEL_ID,
                guild_id: CONFIG.GUILD_ID,
                type: 0, // GUILD_TEXT
            };

            const mockGuild = {
                id: CONFIG.GUILD_ID,
                name: "MP - VIP"
            };

            // Call the internal Discord function with the required arguments
            await _executeCommand({
                command: realCommand,
                optionValues: optionValues, // Pass the populated option values
                context: {
                    channel: mockChannel,
                    guild: mockGuild
                },
                commandOrigin: 1, // 1 = CHAT
                commandTargetId: null
            });

            log(`Command "/${name}" successfully executed (API call sent).`, "info");
            showToast(`Command "/${name}" sent.`, "success");

        } catch (error) {
            log(`Error executing command "/${name}": ${error.message}`, "error");
            console.error("Full error object:", error);
            showToast(`Command Failed: Check console for details.`, "error");
        }
    };

    /** The main scheduler loop that runs every 30 minutes, handling conditional restarts. */
    const runScheduler = async () => {
        // Load modules only once on the very first run
        if (!_modulesLoaded) {
            log("First run: Loading internal modules...", "info");
            const success = await loadModules();
            if (!success) {
                log("Module load failed. Stopping scheduler interval.", "error");
                if (interval) clearInterval(interval);
                interval = null;
                return;
            }
            _modulesLoaded = true;
            log("Modules loaded. Proceeding to run scheduler.", "info");

            // Send test notification on first run if configured
            if (currentSettings.notificationChannelId) {
                log("First run: Sending test notification to configured channel.", "info");
                const testMessage = `✅ **PPMChecker Plugin (v${meta.version})**\n\nThe plugin has successfully loaded and is now monitoring PPM. Notifications are working.`;
                sendRestartNotification(testMessage); // Use the existing notification function
            }
            // End test notification
        }

        if (!_executeCommand) {
            log("Command executor is unavailable. Cannot run PPM check.", "error");
            return;
        }

        log("Scheduler running PPM check sequence...", "info");

        // 1. Execute /clear only if enabled
        if (currentSettings.sendClearCommand) {
            await executeSlashCommand(CLEAR_COMMAND, {}); // Pass empty option values

            // 2. Wait 10 seconds
            log(`Waiting ${CONFIG.CLEAR_DELAY_MS / 1000} seconds before running /ppm...`, "info");
            await wait(CONFIG.CLEAR_DELAY_MS);
        } else {
            log("Skipping /clear command as per config.", "info");
        }


        // 3. Execute the PPM check command
        await executeSlashCommand(PPM_COMMAND, {});
        
        // 4. Wait for the result or timeout
        const ppmResult = await waitForPPMResult();

        if (typeof ppmResult === 'number') {
            // --- Case 1: PPM VALUE CAPTURED (0 or > 0) ---
            if (ppmResult > 0) {
                log(`PPM check complete: Value > 0 (${ppmResult}). No action needed.`, "info");
                // PPM is healthy. Do nothing.
            } else if (ppmResult === 0) {
                log(`PPM check complete: Value is 0. Initiating 6-minute restart sequence.`, "warn");
                
                const notificationMessage = `⚠️ **PPMChecker Alert!** ⚠️\n\nPPM value was **0**. Cluster being stopped now, restarting in ${CONFIG.RELOAD_DELAY_MS / 60000} minutes.`;
                sendRestartNotification(notificationMessage);

                // Restart Sequence Step 1: Stop
                await executeSlashCommand(STOP_COMMAND);
                
                // Restart Sequence Step 2: Wait
                log(`Waiting ${CONFIG.RELOAD_DELAY_MS / 60000} minutes before executing /start...`, "warn");
                await wait(CONFIG.RELOAD_DELAY_MS);
                
                // Restart Sequence Step 3: Start
                await executeSlashCommand(START_COMMAND);
                
                log("Restart sequence complete.", "info");
            }
        } else if (ppmResult === CLUSTER_OFFLINE_MARKER) {
            // --- Case 2: CLUSTER OFFLINE DETECTED ---
            log(`Cluster reported as not started. Initiating /start command immediately.`, "warn");
            
            const notificationMessage = `❌ **PPMChecker Alert!** ❌\n\nCluster reported as **"${CLUSTER_OFFLINE_STRING}"**. Attempting immediate /start.`;
            sendRestartNotification(notificationMessage);

            await executeSlashCommand(START_COMMAND);

        } else if (ppmResult === "TIMEOUT") {
            // --- Case 3: PPM NOT FOUND/TIMEOUT ---
            log(`PPM check timed out (${CONFIG.PPM_TIMEOUT_MS / 1000}s). PPM value could not be found. Initiating /start command.`, "error");
            
            const notificationMessage = `⏱️ **PPMChecker Alert!** ⏱️\n\nPPM check timed out. Attempting immediate /start.`;
            sendRestartNotification(notificationMessage);

            // Attempt to start the cluster
            await executeSlashCommand(START_COMMAND);
        } else if (ppmResult === "RACE_CONDITION") {
            log("Skipping PPM check: Concurrent schedule detected.", "warn");
        }
        
        log("Command sequence finished.", "info");
    };

    // --- Plugin API Methods ---

    return {
        start: () => {
            // Set meta name for logging
            meta.name = "PPMChecker";
            loadConfig(); // Load config.json
            log(`Plugin started (v${meta.version}).`, "info");
            
            // Log config file status
            if (!currentSettings.notificationChannelId) {
                log("Notification Channel ID is not set in PPMChecker.config.json. Notifications will be disabled.", "warn");
            } else {
                log(`Notifications will be sent to channel: ${currentSettings.notificationChannelId}`, "info");
            }
            // Log new config setting
            log(`Send /clear command is set to: ${currentSettings.sendClearCommand}`, "info");


            if (CONFIG.BOT_APPLICATION_ID === "PASTE_YOUR_BOTS_CLIENT_ID_HERE") {
                const msg = "Configuration Error: BOT_APPLICATION_ID is not set! Plugin will not run.";
                log(msg, "error");
                showToast(msg, "error");
                return;
            }

            // Run immediately on start
            runScheduler();

            // Set the recurring interval
            interval = setInterval(runScheduler, CONFIG.INTERVAL_MS);
            log(`Scheduler set to run every ${CONFIG.INTERVAL_MS / 60000} minute(s).`, "info");
            showToast(`PPMChecker started! Next run in ${CONFIG.INTERVAL_MS / 60000} min.`, "success");
        },

        stop: () => {
            if (interval) {
                clearInterval(interval);
                interval = null;
            }
            // Unpatch all modules
            if (_dispatcher) {
                 BdApi.Patcher.unpatchAll(meta.name, _dispatcher);
            }
            if (_ppmResolve) {
                _ppmResolve("STOPPED"); // Clear any pending promise resolvers
            }
            BdApi.Patcher.unpatchAll(meta.name);
            
            // Clear module references
            _executeCommand = null;
            _dispatcher = null;
            _sendMessage = null; 
            _ppmResolve = null;
            _modulesLoaded = false;
            log("Plugin stopped. Interval cleared and dispatcher patch removed.", "info");
            showToast("PPMChecker stopped.", "info");
        },
        
        // --- API Methods for Manual Execution ---

        /**
         * @name RunPPMCheck
         * @description Manually executes the full PPM check and conditional restart logic.
         * @returns {void}
         */
        RunPPMCheck: async () => {
            log("Manual execution requested for PPM check and reload logic.", "info");
             if (!_modulesLoaded) {
                log("Modules not loaded. Attempting to load...", "info");
                const success = await loadModules();
                if (!success) {
                    showToast("Failed to load modules. Cannot run check.", "error");
                    return;
                }
                _modulesLoaded = true;
            }
            await runScheduler();
        },

        /**
         * @name SendStopCommand
         * @description Manually sends the /stop command to the channel.
         * @returns {void}
         */
        SendStopCommand: async () => {
            log("Manual execution requested for /stop command.", "info");
            if (!_modulesLoaded) {
                log("Modules not loaded. Attempting to load...", "info");
                _executeCommand = await loadCommandExecutor();
                if (!_executeCommand) {
                    showToast("Failed to load Command Executor. Cannot send /stop.", "error");
                    return;
                }
                _modulesLoaded = true;
            }
            await executeSlashCommand(STOP_COMMAND);
        },
        
        /**
         * @name SendStartCommand
         * @description Manually sends the /start command to the channel.
         * @returns {void}
         */
        SendStartCommand: async () => {
            log("Manual execution requested for /start command.", "info");
            if (!_modulesLoaded) {
                log("Modules not loaded. Attempting to load...", "info");
                _executeCommand = await loadCommandExecutor();
                if (!_executeCommand) {
                    showToast("Failed to load Command Executor. Cannot send /start.", "error");
                    return;
                }
                _modulesLoaded = true;
            }
            await executeSlashCommand(START_COMMAND);
        }
    };
}

/*@end@*/
