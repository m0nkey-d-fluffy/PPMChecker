/**
 * @name PPMChecker
 * @author m0nkey.d.fluffy
 * @description Automates /ppm checks. Identifies the user's specific status and triggers a verified restart if their PPM is 0 or they are missing from the response list. Helper role users can manage group-wide PPM issues.
 * @version 1.0.8
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

// --- Config for Settings Panel ---
const pluginConfig = {
    settings: [
        {
            type: "text",
            id: "notificationChannelId",
            name: "Notification Channel ID",
            note: "The Discord Channel ID to which all alerts and verbose logs will be sent.",
            value: ""
        },
        {
            type: "switch",
            id: "sendClearCommand",
            name: "Send /clear command",
            note: "If enabled, the /clear command will be executed 10 seconds prior to the /ppm command.",
            value: false
        },
        {
            type: "switch",
            id: "isVerbose",
            name: "Verbose Logging",
            note: "If enabled, all captured PPM responses (including healthy ones) will be sent to the notification channel.",
            value: false
        }
    ]
};

function getSetting(key) {
    return pluginConfig.settings.reduce((found, setting) => found ? found : (setting.id === key ? setting : setting.settings?.find(s => s.id === key)), undefined)
}


function PPMChecker(meta) {

    // --- NODE.JS / BD MODULES ---
    const fs = require("fs");
    const path = require("path");
    const React = BdApi.React;

    // --- CONFIGURATION: Core IDs and Timing ---
    const CONFIG = {
        CHANNEL_ID: "1343184699018842202",              // Chinese channel for monitoring /ppm
        ENGLISH_CHANNEL_ID: "1334845816220811374",      // English channel for helper commands
        GUILD_ID: "1334603881652555896",
        BOT_APPLICATION_ID: "1334630845574676520",
        HELPER_ROLE_ID: "1426619911626686598",          // Helper role for group management
        INTERVAL_MS: 15 * 60 * 1000,         // 15 minutes for scheduling
        CLEAR_DELAY_MS: 10 * 1000,           // 10 seconds delay between /clear and /ppm
        RELOAD_DELAY_MS: 6 * 60 * 1000,      // 6 minutes delay between /stop and /start
        PPM_TIMEOUT_MS: 15 * 1000,           // 15 seconds max wait for PPM response
        VERIFY_WAIT_MS: 2 * 60 * 1000,       // 2 minutes (120s) to wait after /start before verifying
        COOLDOWN_BUFFER_MS: 10 * 1000,       // 10 seconds buffer to add to cooldown timer
        START_RESPONSE_TIMEOUT_MS: 10 * 1000 // 10 seconds max wait for /start response
    };

    // --- STATUS CONSTANTS ---
    const CLUSTER_OFFLINE_STRING = "Cluster not started";
    const CLUSTER_OFFLINE_MARKER = "CLUSTER_OFFLINE_MARKER";

    // --- COMMAND DATA ---
    const CLEAR_COMMAND = { name: "clear", commandId: "1416039398792888330", commandVersion: "1433501849713115315", description: "Clear your friends list", rank: 3, options: [{ "type": 5, "name": "force-remove-all", "description": "If true, removes all friends - keep only favs", "required": false }] };
    const PPM_COMMAND = { name: "ppm", commandId: "1414334983707033774", commandVersion: "1414334983707033780", description: "Check your current PackPerMinute", rank: 1, options: [] };
    const STOP_COMMAND = { name: "stop", commandId: "1414334983707033773", commandVersion: "1414334983707033779", description: "Stop your cluster", rank: 4, options: [] };
    const START_COMMAND = { name: "start", commandId: "1414334983707033772", commandVersion: "1414334983707033778", description: "Start your cluster", rank: 2, options: [] };
    const STOP_CLUSTER_COMMAND = { name: "stop_cluster", commandId: "1426621887114510408", commandVersion: "1426621887114510409", description: "Stop a vip cluster (helper only)", rank: 7, options: [{ "type": 6, "name": "target", "description": "target", "required": true }] };
    const CLOSE_GROUP_COMMAND = { name: "close_group", commandId: "1437564821078937682", commandVersion: "1437564821078937684", description: "Stop a group (helper only)", rank: 8, options: [{ "type": 3, "name": "group-id", "description": "Group ID", "required": true }] };

    // Internal state
    let interval = null;
    let _executeCommand = null;
    let _dispatcher = null;
    let _sendMessage = null;
    let _modulesLoaded = false;
    let _ppmResolve = null;
    let _currentUserId = null;
    let _seenBotMessage = false; // Flag for timeout logic
    let _startCooldownResolve = null; // For handling /start cooldown responses

    // --- SETTINGS MANAGEMENT ---
    const settings = new Proxy({}, {
        get: (_target, key) => { return BdApi.Data.load(meta.name, key) ?? getSetting(key)?.value; },
        set: (_target, key, value) => {
            BdApi.Data.save(meta.name, key, value);
            const setting = getSetting(key);
            if (setting) setting.value = value;
            return true;
        }
    });

    const initSettings = (settingsArray = pluginConfig.settings) => {
        settingsArray.forEach(setting => {
            if (setting.settings) initSettings(setting.settings);
            else if (setting.id) {
                const value = settings[setting.id];
                const settingObj = getSetting(setting.id);
                if (settingObj) settingObj.value = value;
            }
        });
    };

    // --- UTILITIES ---

    const log = (message, type = "info") => {
        try {
            const method = console[type] && typeof console[type] === 'function' ? console[type] : console.log;
            if (type === 'info' || type === 'warn' || type === 'error' || type === 'fatal') {
                method(`%c[${meta.name}]%c ${message}`, "color: #FF69B4; font-weight: bold;", "color: unset; font-weight: unset;");
            } else {
                method(`[${meta.name}] ${message}`);
            }
        } catch (e) { console.log(`[${meta.name} | Fallback Log] ${message}`); }
    };

    const showToast = (message, type = "info") => {
        if (window.BdApi && BdApi.showToast) BdApi.showToast(message, { type });
        else log(`TOAST: ${message}`, type);
    };

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const sendNotification = (message) => {
        if (!_sendMessage || !settings.notificationChannelId) {
            log("Cannot send notification: Send Message module unavailable or Notification Channel ID not set.", "warn");
            return;
        }
        try {
            _sendMessage(settings.notificationChannelId, { content: message, tts: false, invalidEmojis: [], validNonShortcutEmojis: [] }, undefined, {});
        } catch (error) {
            log(`Error sending notification: ${error.message}`, "error");
        }
    };


    // --- MESSAGE LISTENER LOGIC ---

    // Parse all users and group ID from /ppm response
    const parseFullPPMResponse = (text) => {
        if (!text) return null;

        const result = {
            groupId: null,
            users: []
        };

        // Extract group ID (e.g., "Group En:-430275058:1:1")
        const groupMatch = text.match(/Group\s+(.+)/);
        if (groupMatch) {
            result.groupId = groupMatch[1].trim();
        }

        // Extract all users with their PPM values
        // Pattern: @username (optional emojis/text) — 🎁 **PPM_VALUE**
        const userPattern = /<@!?(\d+)>[^🎁]*🎁\s*\*\*([\d.]+)\*\*/g;
        let match;

        while ((match = userPattern.exec(text)) !== null) {
            const userId = match[1];
            const ppm = parseFloat(match[2]);
            result.users.push({ userId, ppm });
        }

        return result.users.length > 0 ? result : null;
    };

    const capturePPMValue = (message) => {
        if (!_ppmResolve) return; 
        _seenBotMessage = true;

        if (!_currentUserId) {
            log("Cannot parse PPM: Current User ID not loaded.", "error");
            return;
        }
        
        const myPpmRegex = new RegExp(`<@!?${_currentUserId}>.*?🎁\\s*\\*\\*(\\d+(?:\\.\\d+)?)\\*\\*`, "s");

        const searchAndResolve = (text, source) => {
            if (!text) return false;

            if (text.includes(CLUSTER_OFFLINE_STRING)) {
                log(`Cluster Status CAPTURED (${source}): "${CLUSTER_OFFLINE_STRING}".`, "warn");
                _ppmResolve(CLUSTER_OFFLINE_MARKER);
                _ppmResolve = null;
                return true;
            }

            const match = text.match(myPpmRegex);
            if (match) {
                const myValue = parseFloat(match[1]);
                const color = myValue > 0 ? "#4CAF50" : "#FF0000";
                const icon = myValue > 0 ? "✅" : "❌";

                console.log(`%c[${meta.name}]%c ${icon} FOUND MY PPM (%c${source}%c): ${myValue}`,
                    `color: ${color}; font-weight: bold;`, "color: unset;", "color: #1a73e8; font-weight: bold;", "color: unset;"
                );

                if (settings.isVerbose && settings.notificationChannelId) {
                    sendNotification(`${icon} My PPM: **${myValue}**`);
                }

                // Parse full response data (all users + group ID)
                const fullData = parseFullPPMResponse(text);

                // Resolve with comprehensive data
                _ppmResolve({
                    myPpm: myValue,
                    fullData: fullData
                });
                _ppmResolve = null;
                return true;
            }
            return false;
        };

        if (searchAndResolve(message.content, "Content")) return;
        if (message.embeds && message.embeds.length > 0) {
            for (const embed of message.embeds) {
                if (searchAndResolve(embed.description, "Embed Description")) return;
                if (searchAndResolve(embed.title, "Embed Title")) return;
                if (embed.fields && embed.fields.length > 0) {
                    for (const field of embed.fields) {
                        if (searchAndResolve(field.value, `Field: ${field.name}`)) return;
                    }
                }
            }
        }
    };

    const waitForPPMResult = () => {
        if (_ppmResolve) return Promise.resolve("RACE_CONDITION");
        _seenBotMessage = false;

        return new Promise(resolve => {
            _ppmResolve = resolve;

            setTimeout(() => {
                if (_ppmResolve) {
                    if (_seenBotMessage) {
                        _ppmResolve("MISSING_USER");
                    } else {
                        _ppmResolve("TIMEOUT");
                    }
                    _ppmResolve = null;
                }
            }, CONFIG.PPM_TIMEOUT_MS);
        });
    };

    // --- COOLDOWN DETECTION FOR /START COMMAND ---

    const parseCooldownTime = (text) => {
        if (!text) return null;

        // Match patterns like "You must wait 02:28 before starting again."
        const cooldownRegex = /You must wait (\d{1,2}):(\d{2}) before starting again/i;
        const match = text.match(cooldownRegex);

        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const totalMs = (minutes * 60 * 1000) + (seconds * 1000);
            return totalMs;
        }
        return null;
    };

    const captureStartCooldown = (message) => {
        if (!_startCooldownResolve) return;

        const searchForCooldown = (text) => {
            if (!text) return false;

            const cooldownMs = parseCooldownTime(text);
            if (cooldownMs !== null) {
                log(`Cooldown detected: ${cooldownMs / 1000} seconds`, "warn");
                _startCooldownResolve({ type: 'cooldown', waitMs: cooldownMs });
                _startCooldownResolve = null;
                return true;
            }
            return false;
        };

        // Search message content
        if (searchForCooldown(message.content)) return;

        // Search embeds
        if (message.embeds && message.embeds.length > 0) {
            for (const embed of message.embeds) {
                if (searchForCooldown(embed.description)) return;
                if (searchForCooldown(embed.title)) return;
                if (embed.fields && embed.fields.length > 0) {
                    for (const field of embed.fields) {
                        if (searchForCooldown(field.value)) return;
                    }
                }
            }
        }

        // If no cooldown found, consider it a success response
        _startCooldownResolve({ type: 'success' });
        _startCooldownResolve = null;
    };

    const waitForStartResponse = () => {
        if (_startCooldownResolve) return Promise.resolve({ type: 'race_condition' });

        return new Promise(resolve => {
            _startCooldownResolve = resolve;

            setTimeout(() => {
                if (_startCooldownResolve) {
                    _startCooldownResolve({ type: 'timeout' });
                    _startCooldownResolve = null;
                }
            }, CONFIG.START_RESPONSE_TIMEOUT_MS);
        });
    };

    // --- INTERNAL MODULE LOADERS ---

    const loadUserIdentity = () => {
        try {
            const userStore = BdApi.Webpack.getModule(BdApi.Webpack.Filters.byProps("getCurrentUser", "getUser"));
            if (userStore) {
                const user = userStore.getCurrentUser();
                if (user) {
                    _currentUserId = user.id;
                    log(`Identified current user as ID: ${_currentUserId}`, "info");
                    return true;
                }
            }
            throw new Error("Could not fetch CurrentUser from store.");
        } catch (e) {
            log(`Failed to identify current user: ${e.message}`, "error");
            return false;
        }
    };

    const loadCommandExecutor = async () => {
        try {
            const moduleFilter = (m) => {
                const target = m.default ? m.default : m;
                if (!target || typeof target !== 'object') return false;
                return Object.keys(target).some(k => {
                    try {
                        const funcString = target[k].toString().toLowerCase();
                        return typeof target[k] === 'function' && funcString.includes("commandorigin") && funcString.includes("optionvalues");
                    } catch (e) { return false; }
                });
            };

            const mod = await BdApi.Webpack.waitForModule(moduleFilter, { first: true });
            if (!mod) throw new Error("Module filter failed.");
            
            const target = mod.default ? mod.default : mod;
            const keyFinder = (t, k) => {
                try {
                    const s = t[k].toString().toLowerCase();
                    return typeof t[k] === 'function' && s.includes("commandorigin") && s.includes("optionvalues");
                } catch (e) { return false; }
            };
            
            const funcKey = Object.getOwnPropertyNames(target).find(k => keyFinder(target, k));
            if (funcKey) return target[funcKey].bind(target);
            else throw new Error("Function key not found.");
        } catch (e) {
            log(`Fatal Error loading Command Executor: ${e.message}`, "error");
            return null;
        }
    };

    const loadDispatcherPatch = async () => {
        try {
            let mod = BdApi.Webpack.getModule(m => m.dispatch && m._events, { searchExports: true });
            if (!mod) mod = BdApi.Webpack.getModule(BdApi.Webpack.Filters.byProps("subscribe", "unsubscribe", "dispatch"));
            const dispatchModule = mod.dispatch ? mod : (mod.default ? mod.default : mod);

            if (!dispatchModule) throw new Error("No Dispatcher found.");
            _dispatcher = dispatchModule;

            BdApi.Patcher.after(meta.name, _dispatcher, "dispatch", (_, args) => {
                const event = args[0];
                if (event.type === 'MESSAGE_CREATE' || event.type === 'MESSAGE_UPDATE') {
                    const message = event.message || event.data;
                    if (message && message.channel_id === CONFIG.CHANNEL_ID && message.author?.id === CONFIG.BOT_APPLICATION_ID) {
                        capturePPMValue(message);
                        captureStartCooldown(message);
                    }
                }
            });
            log(`SUCCESS: Patched Discord Dispatcher.`, "info");
        } catch (error) {
            log(`Failed to patch Event Dispatcher: ${error.message}`, "error");
        }
    };

    const loadSendMessageModule = async () => {
        try {
            const mod = await BdApi.Webpack.waitForModule(BdApi.Webpack.Filters.byProps("sendMessage", "receiveMessage"));
            _sendMessage = mod.sendMessage;
        } catch (error) {
            log(`Failed to load Send Message module`, "error");
        }
    };

    const loadModules = async () => {
        loadUserIdentity();
        _executeCommand = await loadCommandExecutor();
        if (!_executeCommand) {
            log("Critical Command Executor failed to load.", "fatal");
            return false;
        }
        await loadDispatcherPatch();
        await loadSendMessageModule();
        return true;
    };

    // --- HELPER ROLE CHECKING ---

    const hasHelperRole = () => {
        try {
            const GuildMemberStore = BdApi.Webpack.getModule(m => m.getMember, { searchExports: true });
            if (!GuildMemberStore) {
                log("Could not find GuildMemberStore for role check.", "warn");
                return false;
            }

            const member = GuildMemberStore.getMember(CONFIG.GUILD_ID, _currentUserId);
            if (!member) {
                log("Could not find current user's guild member data.", "warn");
                return false;
            }

            const hasRole = member.roles && member.roles.includes(CONFIG.HELPER_ROLE_ID);
            if (hasRole) {
                log("Helper role check: ✅ PASS", "info");
            }
            return hasRole;
        } catch (error) {
            log(`Error checking helper role: ${error.message}`, "error");
            return false;
        }
    };


    // --- EXECUTION LOGIC ---

    const executeSlashCommand = async (command, optionValues = {}, channelId = null) => {
        if (!_executeCommand) {
            log("Command Executor unavailable.", "error");
            return;
        }
        const name = command.name;
        const targetChannelId = channelId || CONFIG.CHANNEL_ID;
        log(`Executing COMMAND: "/${name}" in channel ${targetChannelId}`, "info");

        try {
            const realCommand = {
                id: command.commandId,
                version: command.commandVersion,
                type: 1,
                inputType: 3,
                name: name,
                applicationId: CONFIG.BOT_APPLICATION_ID,
                options: command.options || [],
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
                        bot: { id: CONFIG.BOT_APPLICATION_ID, username: "Dreama", discriminator: "5958", avatar: "17d39a9b7ea9ce8ed69a57eb99f6f37f", bot: true }
                    }
                }
            };

            const mockChannel = { id: targetChannelId, guild_id: CONFIG.GUILD_ID, type: 0 };
            const mockGuild = { id: CONFIG.GUILD_ID };

            await _executeCommand({
                command: realCommand,
                optionValues: optionValues,
                context: { channel: mockChannel, guild: mockGuild },
                commandOrigin: 1,
                commandTargetId: null
            });

        } catch (error) {
            log(`Error executing "/${name}": ${error.message}`, "error");
        }
    };

    const executeStartWithCooldownHandling = async () => {
        log("Attempting to execute /start command...", "info");

        // Execute the /start command
        await executeSlashCommand(START_COMMAND);

        // Wait for bot response
        const response = await waitForStartResponse();

        if (response.type === 'cooldown') {
            const totalWaitMs = response.waitMs + CONFIG.COOLDOWN_BUFFER_MS;
            const minutes = Math.floor(totalWaitMs / 60000);
            const seconds = Math.floor((totalWaitMs % 60000) / 1000);

            log(`Cooldown detected! Waiting ${minutes}m ${seconds}s (original cooldown + 10s buffer)...`, "warn");
            sendNotification(`⏳ **Cooldown Detected**\nWaiting ${minutes}m ${seconds}s before retrying /start...`);

            // Wait for cooldown period + buffer
            await wait(totalWaitMs);

            // Retry the /start command
            log("Cooldown expired. Retrying /start command...", "info");
            await executeSlashCommand(START_COMMAND);

            // Wait for response again (in case there's still a cooldown)
            const retryResponse = await waitForStartResponse();
            if (retryResponse.type === 'cooldown') {
                log("Still on cooldown after retry. Manual intervention may be required.", "error");
                sendNotification("⚠️ **Still on cooldown** after retry. Please check manually.");
            } else {
                log("/start command executed successfully after cooldown.", "info");
                if (settings.isVerbose) {
                    sendNotification("✅ **/start Success**\nCluster start command executed successfully after cooldown.");
                }
            }
        } else if (response.type === 'success') {
            log("/start command executed successfully.", "info");
            if (settings.isVerbose) {
                sendNotification("✅ **/start Success**\nCluster start command executed successfully.");
            }
        } else if (response.type === 'timeout') {
            log("/start command sent, but no response received (assuming success).", "warn");
            if (settings.isVerbose) {
                sendNotification("⏱️ **/start Timeout**\nNo response received (assuming success).");
            }
        }
    };

    const verifyRestart = async () => {
        log(`Waiting ${CONFIG.VERIFY_WAIT_MS / 60000} minutes for cluster to warm up before verification...`, "info");
        await wait(CONFIG.VERIFY_WAIT_MS);

        log("Sending verification /ppm command...", "info");
        await executeSlashCommand(PPM_COMMAND, {});
        const verificationResult = await waitForPPMResult();

        // Handle new object format
        const myPpm = (typeof verificationResult === 'object' && verificationResult.myPpm !== undefined)
            ? verificationResult.myPpm
            : verificationResult;

        if (typeof myPpm === 'number' && myPpm > 0) {
            log("VERIFICATION SUCCESS: PPM is > 0.", "info");
            sendNotification("✅ **Restart Successful**\nCluster is back online and PPM is healthy.");
        } else {
            log("VERIFICATION FAILED: Cluster still reporting 0, missing, or timed out.", "error");
            sendNotification("🚨 **Restart FAILED**\nCluster is still offline. Manual check required.");
        }
    };

    // --- MULTI-USER PPM CHECKING (HELPER ROLE) ---

    const handleGroupPPMCheck = async (fullData) => {
        if (!fullData || !fullData.users || fullData.users.length === 0) {
            log("No group data available for multi-user check.", "info");
            return;
        }

        // Check if current user has helper role
        if (!hasHelperRole()) {
            log("User does not have helper role. Skipping group-wide checks.", "info");
            return;
        }

        log(`Helper role detected. Checking all ${fullData.users.length} users in group...`, "info");

        // Debug: Log all parsed users and their PPM values
        fullData.users.forEach(u => {
            log(`  User ${u.userId}: PPM = ${u.ppm}`, "info");
        });

        // Find users with 0 PPM (excluding current user)
        const usersWithZeroPPM = fullData.users.filter(u => u.ppm === 0 && u.userId !== _currentUserId);
        const allUsersZero = fullData.users.every(u => u.ppm === 0);

        log(`Found ${usersWithZeroPPM.length} other users with 0 PPM. All users zero: ${allUsersZero}. Group ID: ${fullData.groupId || 'NOT FOUND'}`, "info");

        // If ALL users have 0 PPM, close the entire group
        if (allUsersZero && fullData.groupId) {
            log(`All users have 0 PPM! Closing entire group: ${fullData.groupId}`, "warn");
            sendNotification(`🚨 **Group Alert** 🚨\nAll users in group have 0 PPM. Closing group ${fullData.groupId}...`);

            await executeSlashCommand(CLOSE_GROUP_COMMAND, {
                "group-id": [{ type: "text", text: fullData.groupId }]
            }, CONFIG.ENGLISH_CHANNEL_ID);

            sendNotification(`✅ Group ${fullData.groupId} has been closed.`);
            return;
        }

        // Otherwise, stop individual users with 0 PPM
        if (usersWithZeroPPM.length > 0) {
            log(`Stopping ${usersWithZeroPPM.length} users with 0 PPM...`, "info");
            sendNotification(`⚠️ **Helper Action** ⚠️\nStopping ${usersWithZeroPPM.length} user(s) with 0 PPM...`);

            for (const user of usersWithZeroPPM) {
                log(`Stopping cluster for user ${user.userId}...`, "info");
                await executeSlashCommand(STOP_CLUSTER_COMMAND, {
                    "target": [{ type: "userMention", userId: user.userId }]
                });
                await wait(2000); // Small delay between commands
            }

            const userMentions = usersWithZeroPPM.map(u => `<@${u.userId}>`).join(', ');
            sendNotification(`🛑 Stopped ${usersWithZeroPPM.length} user(s): ${userMentions}`);
        }
    };

    const runScheduler = async () => {
        if (!_modulesLoaded) {
            log("First run: Loading modules...", "info");
            const success = await loadModules();
            if (!success) {
                if (interval) clearInterval(interval);
                interval = null;
                return;
            }
            _modulesLoaded = true;
            if (settings.notificationChannelId) {
                sendNotification(`✅ **PPMChecker (v${meta.version})** Started. Monitoring for user ID: ${_currentUserId}`);
            }
        }

        if (!_executeCommand) return;
        log("Scheduler running check...", "info");

        // --- STEP 1: Execute /clear (If Enabled) ---
        if (settings.sendClearCommand) {
            log("Setting 'sendClearCommand' is ON. Executing /clear.", "info");
            await executeSlashCommand(CLEAR_COMMAND, {}); 
            log(`Waiting ${CONFIG.CLEAR_DELAY_MS / 1000}s before /ppm...`, "info");
            await wait(CONFIG.CLEAR_DELAY_MS);
        } else {
            log("Setting 'sendClearCommand' is OFF. Skipping /clear.", "info");
        }

        // --- STEP 2: Execute /ppm & Wait for Result ---
        await executeSlashCommand(PPM_COMMAND, {});
        const ppmResult = await waitForPPMResult();

        // --- STEP 3: Extract Data & Handle Group-Wide Checks (Helper Role) ---
        let myPpm = ppmResult;
        let fullData = null;

        // Handle new object format
        if (typeof ppmResult === 'object' && ppmResult !== null && ppmResult.myPpm !== undefined) {
            myPpm = ppmResult.myPpm;
            fullData = ppmResult.fullData;
        }

        // Check group-wide PPM issues (Helper role only)
        if (fullData && fullData.users) {
            await handleGroupPPMCheck(fullData);
        }

        // --- STEP 4: Handle Current User's Result ---
        if (typeof myPpm === 'number') {
            if (myPpm > 0) {
                log(`My PPM is Healthy (> 0): ${myPpm}.`, "info");
            } else if (myPpm === 0) {
                log(`My PPM is 0. Initiating Restart.`, "warn");
                sendNotification(`⚠️ **PPMChecker Alert!** ⚠️\nYOUR PPM is **0**. Restarting cluster...`);

                await executeSlashCommand(STOP_COMMAND);
                log(`Waiting ${CONFIG.RELOAD_DELAY_MS / 60000} mins...`, "warn");
                await wait(CONFIG.RELOAD_DELAY_MS);
                await executeStartWithCooldownHandling();
                await verifyRestart();
            }
        } else if (myPpm === CLUSTER_OFFLINE_MARKER) {
            log(`Cluster offline. Sending /start.`, "warn");
            sendNotification(`❌ **PPMChecker Alert!** ❌\nCluster "Not Started". Sending /start.`);
            await executeStartWithCooldownHandling();
            await verifyRestart();

        } else if (myPpm === "MISSING_USER") {
            log(`Bot replied, but User ID not found. Initiating Restart.`, "warn");
            sendNotification(`❓ **PPMChecker Alert!** ❓\nYour ID was not found in the list. Restarting cluster...`);

            await executeSlashCommand(STOP_COMMAND);
            log(`Waiting ${CONFIG.RELOAD_DELAY_MS / 60000} mins...`, "warn");
            await wait(CONFIG.RELOAD_DELAY_MS);
            await executeStartWithCooldownHandling();
            await verifyRestart();

        } else if (myPpm === "TIMEOUT") {
            log(`Bot did not reply (TIMEOUT). Doing nothing until next cycle.`, "warn");
            if (settings.isVerbose) {
                sendNotification(`⏱️ PPM check timed out (bot did not reply). Taking no action.`);
            }

        } else if (myPpm === "RACE_CONDITION") {
            log("Skipping concurrent check.", "warn");
        }

        log("Sequence finished.", "info");
    };

    return {
        start: () => {
            meta.name = "PPMChecker";
            initSettings();
            log(`Plugin started (v${meta.version}).`, "info");
            if (CONFIG.BOT_APPLICATION_ID === "PASTE_YOUR_BOTS_CLIENT_ID_HERE") {
                showToast("Config Error: BOT_APPLICATION_ID not set!", "error");
                return;
            }
            runScheduler();
            interval = setInterval(runScheduler, CONFIG.INTERVAL_MS);
            showToast(`PPMChecker started!`, "success");
        },
        stop: () => {
            if (interval) { clearInterval(interval); interval = null; }
            if (_dispatcher) BdApi.Patcher.unpatchAll(meta.name, _dispatcher);
            if (_ppmResolve) _ppmResolve("STOPPED");
            if (_startCooldownResolve) _startCooldownResolve({ type: 'stopped' });

            BdApi.Patcher.unpatchAll(meta.name);

            _executeCommand = null;
            _dispatcher = null;
            _sendMessage = null;
            _ppmResolve = null;
            _startCooldownResolve = null;
            _modulesLoaded = false;
            log("Stopped.", "info");
            showToast("PPMChecker stopped.", "info");
        },
        getSettingsPanel: () => {
            initSettings();
            return BdApi.UI.buildSettingsPanel({
                settings: pluginConfig.settings,
                onChange: (category, id, value) => { settings[id] = value; }
            });
        },
        RunPPMCheck: async () => {
            if (!_modulesLoaded) { await loadModules(); _modulesLoaded = true; }
            await runScheduler();
        },
        SendStopCommand: async () => {
            if (!_modulesLoaded) { await loadModules(); _modulesLoaded = true; }
            await executeSlashCommand(STOP_COMMAND);
        },
        SendStartCommand: async () => {
            if (!_modulesLoaded) { await loadModules(); _modulesLoaded = true; }
            await executeStartWithCooldownHandling();
        }
    };
}

/*@end@*/