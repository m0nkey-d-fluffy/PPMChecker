/**
 * @name PPMChecker
 * @author m0nkey.d.fluffy
 * @description Automatically runs /clear then /ppm every 30 mins, monitors the response, and restarts the cluster if PPM is 0.
 * @version 1.0.2
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

// Renamed main function
function PPMChecker(meta) {

    // --- NODE.JS MODULES ---
    // These are provided by the BetterDiscord environment
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

    // This is the /clear command ID that is used by @Dreama. This is used for our /clear payload.
    const CLEAR_COMMAND = {
        name: "clear",
        commandId: "1416039398792888330",
        commandVersion: "1433501849713115315",
        description: "Clear your friends list (Keep your GP friends and Favs)",
        rank: 3,
        options: [ // Define options so the payload builds correctly
            {
                "type": 5,
                "name": "force-remove-all",
                "description": "If true, removes all friends - keep only favs",
                "required": false
            }
        ]
    };

    // This is the /ppm command ID that is used by @Dreama. This is used for our /ppm payload.
    const PPM_COMMAND = {
        name: "ppm",
        commandId: "1414334983707033774",
        commandVersion: "1414334983707033780",
        description: "Check your current PackPerMinute",
        rank: 1,
        options: []
    };

    // This is the /stop command ID that is used by @Dreama. This is used for our /stop payload.
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

    // The sequence of commands to run every 15 minutes. (Order matters)
    const COMMANDS = [CLEAR_COMMAND, PPM_COMMAND]; 

    // Internal state
    let interval = null;
    let _executeCommand = null;
    let _dispatcher = null; 
    let _sendMessage = null; // For sending notifications
    let _nonceGenerator = null; // [NEW] For creating valid nonces
    let _modulesLoaded = false;
    let _ppmResolve = null; // Function to resolve the current PPM check Promise

    // --- SETTINGS MANAGEMENT (via config.json) ---
    const configPath = path.join(BdApi.Plugins.folder, "PPMChecker.config.json");
    const defaultSettings = {
        notificationChannelId: "", // User configurable channel ID
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
                currentSettings = { ...defaultSettings, ...configData };
                log("Config file loaded successfully.", "info");
            } catch (e) {
                log(`Failed to read or parse config file: ${e.message}`, "error");
                currentSettings = { ...defaultSettings };
            }
        }
    };


    // --- UTILITIES ---

    /** A helper to safely log messages into the console with pink highlight for notices. */
    const log = (message, type = "info") => {
        try {
            const method = console[type] && typeof console[type] === 'function' ? console[type] : console.log;
            
            if (type === 'info' || type === 'warn' || type === 'error' || type === 'fatal') {
                // Pink highlight for general plugin notices
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
        if (!_sendMessage || !currentSettings.notificationChannelId) {
            log("Cannot send notification: Send Message module unavailable or Notification Channel ID not set.", "warn");
            return;
        }
        
        if (!_nonceGenerator) {
            log("Cannot send notification: Nonce Generator module is not loaded.", "error");
            return;
        }

        try {
            // [FIX] Create a full message object with a valid nonce
            const messageData = { 
                content: message, 
                tts: false,
                nonce: _nonceGenerator.create() // Create a valid nonce
            };
            _sendMessage(currentSettings.notificationChannelId, messageData);
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

        // Regex to find "PPM:" followed by optional whitespace and a number (including decimals), robustly.
        const ppmRegex = /PPM:\s*(\d+(\.\d+)?)/i; 

        const searchAndResolve = (text, source) => {
            if (!text) return false;
            
            // 1. Check for critical offline message first
            if (text.includes(CLUSTER_OFFLINE_STRING)) {
                log(`Cluster Status CAPTURED (${source}): "${CLUSTER_OFFLINE_STRING}". Initiating /start.`, "warn");
                _ppmResolve(CLUSTER_OFFLINE_MARKER); // Resolve with marker string
                _ppmResolve = null; 
                return true;
            }

            // 2. Check for PPM value
            const match = text.match(ppmRegex);
            if (match) {
                const capturedValue = parseFloat(match[1]);

                // Conditional logging based on value (Green for > 0, Red for 0)
                const color = capturedValue > 0 ? "#4CAF50" : "#FF0000";
                const icon = capturedValue > 0 ? "✅" : "❌";

                // Absolute fix for dynamic logging inside patcher
                console.log(`%c[${meta.name}]%c ${icon} PPM Value CAPTURED (%c${source}%c): ${match[0]}`, 
                    `color: ${color}; font-weight: bold;`, 
                    "color: unset; font-weight: unset;",
                    "color: #1a73e8; font-weight: bold;",
                    "color: unset; font-weight: unset;"
                );
                
                // Resolve the promise immediately
                _ppmResolve(capturedValue);
                _ppmResolve = null; // Clear the resolver
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
            // Already waiting for a result, return a failure to prevent race condition
            return Promise.resolve("RACE_CONDITION");
        }
        
        return new Promise(resolve => {
            _ppmResolve = resolve;
            
            // Set up a timeout to handle cases where the bot doesn't respond (Not Found Case)
            setTimeout(() => {
                if (_ppmResolve) {
                    _ppmResolve("TIMEOUT");
                    _ppmResolve = null; // Clear the resolver
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
            
            // Webpack Search (Primary search)
            let mod = BdApi.Webpack.getModule(m => m.dispatch && m._events, { searchExports: true });
            if (!mod) mod = BdApi.Webpack.getModule(BdApi.Webpack.Filters.byProps("subscribe", "unsubscribe", "dispatch"));
            dispatchModule = mod.dispatch ? mod : (mod.default ? mod.default : mod);

            if (!dispatchModule || typeof dispatchModule.dispatch !== 'function') {
                throw new Error("Could not locate a usable Dispatcher module.");
            }
            
            _dispatcher = dispatchModule;
            
            // Patch the core dispatch function to intercept MESSAGE_CREATE and MESSAGE_UPDATE events
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
     * Finds Discord's internal sendMessage function.
     */
    const loadSendMessageModule = async () => {
        try {
            log("Attempting to find Send Message module...");
            // This is a more robust filter that looks for the module handling all three key message events
            const mod = BdApi.Webpack.getModule(BdApi.Webpack.Filters.byProps("sendMessage", "editMessage", "receiveMessage"), { searchExports: true });
            
            if (!mod || !mod.sendMessage) throw new Error("Could not find sendMessage function.");
            
            _sendMessage = mod.sendMessage.bind(mod);
            log(`SUCCESS: Found Send Message module.`, "info");

        } catch (error) {
            log(`Failed to load Send Message module: ${error.message}`, "error");
            _sendMessage = null;
        }
    };

    /**
     *  Finds Discord's internal NonceGenerator.
     */
    const loadNonceGenerator = async () => {
        try {
            log("Attempting to find Nonce Generator module...");
            _nonceGenerator = BdApi.Webpack.getModule(BdApi.Webpack.Filters.byProps("create", "NONCE_PLACEHOLDER"));
            if (!_nonceGenerator) throw new Error("Could not find NonceGenerator.");
            log(`SUCCESS: Found Nonce Generator module.`, "info");
        } catch (error) {
            log(`Failed to load Nonce Generator module: ${error.message}`, "error");
        }
    };

    /**
     * Orchestrates loading all modules.
     * @returns {Promise<boolean>} True if the critical module was successful.
     */
    const loadModules = async () => {
        // 1. CRITICAL: Load command executor first
        _executeCommand = await loadCommandExecutor();
        if (!_executeCommand) {
            log("Critical Command Executor failed to load. Plugin cannot run commands.", "fatal");
            return false;
        }

        // 2. OPTIONAL: Load Dispatcher Patch.
        await loadDispatcherPatch();

        // 3. OPTIONAL: Load Send Message module.
        await loadSendMessageModule();
        
        // 4. OPTIONAL: Load Nonce Generator (for sending messages).
        await loadNonceGenerator();

        return true;
    };


    // --- EXECUTION LOGIC ---

    /**
     * Executes a slash command using the internal Discord API function.
     * @param {object} command The command object.
     * @param {object} [optionValues={}] Key/value pairs for options (e.g., { "force-remove-all": true })
     */
    const executeSlashCommand = async (command, optionValues = {}) => {
        if (!_executeCommand) {
            log("Command Executor module is not loaded. Cannot execute command.", "error");
            return;
        }

        const name = command.name;
        log(`Attempting to execute SLIDE COMMAND: "/${name}" to channel ID ${CONFIG.CHANNEL_ID}`, "info");

        try {
            // Build the required command/context objects that are expected when sending SLIDE COMMANDS to @Dreama
            const realCommand = {
                id: command.commandId,
                version: command.commandVersion,
                type: 1, // CHAT_INPUT
                inputType: 3, // CHAT
                name: name,
                applicationId: CONFIG.BOT_APPLICATION_ID,
                options: command.options || [], // Use defined options
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
                optionValues: optionValues, // Pass the options (e.g., {} for /clear)
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

    /** The main scheduler loop that runs every 15 minutes, handling conditional restarts. */
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

            // --- SEND TEST MESSAGE ON FIRST RUN ---
            if (currentSettings.notificationChannelId) {
                log("First run: Sending test notification to configured channel.", "info");
                const testMessage = `✅ **PPMChecker Plugin (v${meta.version})**\n\nThis is a test message. The plugin has successfully loaded and is now monitoring PPM. Notifications are working.`;
                sendRestartNotification(testMessage); // Use the existing notification function
            }
            // --- [END] SEND TEST MESSAGE ---
        }

        if (!_executeCommand) {
            log("Command executor is unavailable. Cannot run PPM check.", "error");
            return;
        }

        log("Scheduler running PPM check sequence...", "info");

        // 1. Execute the /clear command
        // We pass {} for optionValues, matching the payload you provided.
        await executeSlashCommand(CLEAR_COMMAND, {});

        // 2. Wait 10 seconds
        log(`Waiting ${CONFIG.CLEAR_DELAY_MS / 1000} seconds before running /ppm...`, "info");
        await wait(CONFIG.CLEAR_DELAY_MS);

        // 3. Execute the PPM check command
        await executeSlashCommand(PPM_COMMAND, {});
        
        // 4. Wait for the result or timeout
        const ppmResult = await waitForPPMResult();

        if (typeof ppmResult === 'number') {
            // --- PPM VALUE CAPTURED (0 or > 0) ---
            if (ppmResult > 0) {
                log(`PPM check complete: Value > 0 (${ppmResult}). No action needed.`, "info");
                // Do nothing else, schedule continues normally
            } else if (ppmResult === 0) {
                log(`PPM check complete: Value is 0. Initiating 6-minute restart sequence.`, "warn");
                
                const notificationMessage = `⚠️ **PPMChecker Alert!** ⚠️\n\nPPM value was **0**. Cluster being stopped now, restarting in ${CONFIG.RELOAD_DELAY_MS / 60000} minutes.`;
                sendRestartNotification(notificationMessage);

                // 4a. Execute /stop command
                await executeSlashCommand(STOP_COMMAND);
                
                // 4b. Wait 6 minutes
                log(`Waiting ${CONFIG.RELOAD_DELAY_MS / 60000} minutes before executing /start...`, "warn");
                await wait(CONFIG.RELOAD_DELAY_MS);
                
                // 4c. Execute /start command
                await executeSlashCommand(START_COMMAND);
                
                log("Restart sequence complete.", "info");
            }
        } else if (ppmResult === CLUSTER_OFFLINE_MARKER) {
            // --- CLUSTER OFFLINE DETECTED ---
            log(`Cluster reported as not started. Initiating /start command immediately.`, "warn");
            
            const notificationMessage = `❌ **PPMChecker Alert!** ❌\n\nCluster reported as **"${CLUSTER_OFFLINE_STRING}"**. Attempting immediate /start.`;
            sendRestartNotification(notificationMessage);

            await executeSlashCommand(START_COMMAND);

        } else if (ppmResult === "TIMEOUT") {
            // --- PPM NOT FOUND/TIMEOUT ---
            log(`PPM check timed out (${CONFIG.PPM_TIMEOUT_MS / 1000}s). PPM value could not be found. Initiating /start command.`, "error");
            
            const notificationMessage = `⏱️ **PPMChecker Alert!** ⏱️\n\nPPM check timed out. Attempting immediate /start.`;
            sendRestartNotification(notificationMessage);

            // Execute /start command immediately
            await executeSlashCommand(START_COMMAND);
        } else if (ppmResult === "RACE_CONDITION") {
            log("Skipping PPM check: Concurrent schedule detected.", "warn");
        }
        
        log("Command sequence finished.", "info");
    };

    // --- Plugin API Methods ---

    // Renamed return object
    return {
        // Renamed meta name
        start: () => {
            // Ensure meta name is set for logging
            meta.name = "PPMChecker";
            loadConfig(); // Load config.json on start
            log(`Plugin started (v${meta.version}).`, "info");
            
            // Log config status
            if (!currentSettings.notificationChannelId) {
                log("Notification Channel ID is not set in PPMChecker.config.json. Notifications will be disabled.", "warn");
            } else {
                log(`Notifications will be sent to channel: ${currentSettings.notificationChannelId}`, "info");
            }

            if (CONFIG.BOT_APPLICATION_ID === "PASTE_YOUR_BOTS_CLIENT_ID_HERE") {
                const msg = "Configuration Error: BOT_APPLICATION_ID is not set! Plugin will not run.";
                log(msg, "error");
                showToast(msg, "error");
                return;
            }

            // Run immediately on start, which handles the initial module loading.
            runScheduler();

            // Set the recurring interval.
            interval = setInterval(runScheduler, CONFIG.INTERVAL_MS);
            log(`Scheduler set to run every ${CONFIG.INTERVAL_MS / 60000} minute(s).`, "info");
            showToast(`PPMChecker started! Next run in ${CONFIG.INTERVAL_MS / 60000} min.`, "success");
        },

        stop: () => {
            if (interval) {
                clearInterval(interval);
                interval = null;
            }
            if (_dispatcher) {
                 BdApi.Patcher.unpatchAll(meta.name, _dispatcher);
            }
            if (_ppmResolve) {
                _ppmResolve("STOPPED"); // Clear any pending promises
            }
            BdApi.Patcher.unpatchAll(meta.name);
            _executeCommand = null;
            _dispatcher = null;
            _sendMessage = null; // Clear send message module
            _nonceGenerator = null; // Clear nonce generator module
            _ppmResolve = null;
            _modulesLoaded = false;
            log("Plugin stopped. Interval cleared and dispatcher patch removed.", "info");
            showToast("PPMChecker stopped.", "info");
        },
        
        // --- MANUAL EXECUTION METHODS ---

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
