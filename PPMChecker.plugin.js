/**
 * @name PPMChecker
 * @author m0nkey.d.fluffy
 * @description Automates /ppm checks. Identifies the user's specific status and triggers a verified restart if their PPM is 0 or they are missing from the response list. Helper role users can manage group-wide PPM issues.
 * @version 1.0.11
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
            type: "text",
            id: "userNotificationChannelId",
            name: "User Notification Channel ID (Helper)",
            note: "Channel where helper actions (/close_group commands) are executed and users are pinged. Falls back to English channel if not set.",
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
        },
        {
            type: "switch",
            id: "antiIdle",
            name: "Anti-Idle (Typing Indicator)",
            note: "If enabled, sends a typing indicator to the notification channel every 4 minutes to prevent idle status. Only works if notification channel is set.",
            value: false
        },
        {
            type: "switch",
            id: "forceIndividualStops",
            name: "Force Individual Stops (Helper)",
            note: "If enabled, always use /stop_cluster for individual users instead of /close_group for dead groups.",
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
        START_RESPONSE_TIMEOUT_MS: 10 * 1000, // 10 seconds max wait for /start response
        AUTO_KICK_REJOIN_DELAY_MS: 5 * 60 * 1000 + 10 * 1000, // 5 minutes 10 seconds (310s) delay before auto-rejoin
        NOTIFICATION_RATE_LIMIT_MS: 2000,    // 2 seconds between notifications (Discord allows ~5 per 5s)
        MAX_NOTIFICATION_QUEUE: 20,          // Max queued notifications to prevent memory issues
        ANTI_IDLE_INTERVAL_MS: 4 * 60 * 1000 // 4 minutes - send typing indicator to prevent idle (Discord idles after 5 min)
    };

    // --- STATUS CONSTANTS ---
    const CLUSTER_OFFLINE_STRING = "Cluster not started";
    const CLUSTER_OFFLINE_MARKER = "CLUSTER_OFFLINE_MARKER";
    const AUTO_KICK_TITLE = "Auto Kick";
    const AUTO_KICK_MESSAGE = "You have reached 99 friends";

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
    let _autoRejoinTimeout = null; // For tracking auto-rejoin timer
    let _notificationQueue = []; // Queue for rate-limited notifications
    let _notificationProcessing = false; // Flag to prevent concurrent queue processing
    let _antiIdleInterval = null; // Interval for anti-idle typing indicators
    let _typingModule = null; // Discord typing module

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

    // --- RATE-LIMITED NOTIFICATION SYSTEM ---

    const processNotificationQueue = async () => {
        if (_notificationProcessing || _notificationQueue.length === 0) return;
        _notificationProcessing = true;

        while (_notificationQueue.length > 0) {
            const message = _notificationQueue.shift();

            if (!_sendMessage || !settings.notificationChannelId) {
                log("Cannot send notification: Send Message module unavailable or Notification Channel ID not set.", "warn");
                continue;
            }

            try {
                await _sendMessage(settings.notificationChannelId, {
                    content: message,
                    tts: false,
                    invalidEmojis: [],
                    validNonShortcutEmojis: []
                }, undefined, {});

                log(`Notification sent (${_notificationQueue.length} remaining in queue)`, "info");

                // Wait between messages to avoid rate limit
                if (_notificationQueue.length > 0) {
                    await wait(CONFIG.NOTIFICATION_RATE_LIMIT_MS);
                }
            } catch (error) {
                log(`Error sending notification: ${error.message}`, "error");

                // If rate limited, wait longer before retrying
                if (error.message && error.message.includes("rate limit")) {
                    log("Rate limit hit! Waiting 5 seconds before retry...", "warn");
                    await wait(5000);
                }
            }
        }

        _notificationProcessing = false;
    };

    const sendNotification = (message) => {
        if (!_sendMessage || !settings.notificationChannelId) {
            log("Cannot send notification: Send Message module unavailable or Notification Channel ID not set.", "warn");
            return;
        }

        // Add to queue
        _notificationQueue.push(message);

        // Warn if queue is getting large
        if (_notificationQueue.length > CONFIG.MAX_NOTIFICATION_QUEUE) {
            log(`Warning: Notification queue exceeded ${CONFIG.MAX_NOTIFICATION_QUEUE} messages! Dropping oldest message.`, "warn");
            _notificationQueue.shift(); // Remove oldest message
        }

        // Log queue status
        if (_notificationQueue.length > 5) {
            log(`Notification queued (${_notificationQueue.length} in queue)`, "warn");
        }

        // Start processing queue
        processNotificationQueue();
    };


    // --- MESSAGE LISTENER LOGIC ---

    // Parse all users and group ID from /ppm response
    const parseFullPPMResponse = (text) => {
        if (!text) return null;

        const result = {
            groupId: null,
            groupName: null,
            users: []
        };

        // Extract group ID (e.g., "Group En:-430275058:1:1")
        const groupMatch = text.match(/Group\s+(.+)/);
        if (groupMatch) {
            result.groupId = groupMatch[1].trim();
            // Extract group name (part before first colon)
            const colonIndex = result.groupId.indexOf(':');
            if (colonIndex !== -1) {
                result.groupName = result.groupId.substring(0, colonIndex);
            } else {
                result.groupName = result.groupId;
            }
        }

        // Extract all users with their display names, leader status, and PPM values
        // Pattern: <@userid> displayName (optional 👑 Leader or other emojis) — 🎁 **PPM_VALUE**
        // Capture everything between <@userid> and the — to get the display name
        const userPattern = /<@!?(\d+)>\s*([^—]+?)\s*—\s*🎁\s*\*\*([\d.]+)\*\*/g;
        let match;

        while ((match = userPattern.exec(text)) !== null) {
            const userId = match[1];
            let displayInfo = match[2].trim();
            const ppm = parseFloat(match[3]);

            // Check if user is leader
            const isLeader = displayInfo.includes('👑');

            // Clean up display name (remove leader crown and "Leader" text)
            let displayName = displayInfo
                .replace(/👑/g, '')
                .replace(/Leader/g, '')
                .trim();

            result.users.push({ userId, displayName, isLeader, ppm });
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

        const searchAndResolve = (text, source, embedTitle = null) => {
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
                // Combine embed title with text to capture group ID from title
                const combinedText = embedTitle ? `${embedTitle}\n${text}` : text;
                const fullData = parseFullPPMResponse(combinedText);

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
                if (searchAndResolve(embed.description, "Embed Description", embed.title)) return;
                if (searchAndResolve(embed.title, "Embed Title")) return;
                if (embed.fields && embed.fields.length > 0) {
                    for (const field of embed.fields) {
                        if (searchAndResolve(field.value, `Field: ${field.name}`, embed.title)) return;
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

    // --- AUTO KICK DETECTION & REJOIN ---

    const detectAutoKick = (message) => {
        // Only process DMs from the bot
        if (message.guild_id || message.author?.id !== CONFIG.BOT_APPLICATION_ID) return;

        const searchForAutoKick = (title, description) => {
            if (!title && !description) return false;

            // Check for Auto Kick in title and "99 friends" message
            const hasAutoKickTitle = title && title.includes(AUTO_KICK_TITLE);
            const hasKickMessage = description && description.includes(AUTO_KICK_MESSAGE);

            if (hasAutoKickTitle && hasKickMessage) {
                log(`🚨 AUTO KICK DETECTED! Bot kicked us for reaching 99 friends.`, "warn");
                sendNotification(`🚨 **Auto Kick Detected**\nKicked for reaching 99 friends. Rejoining in ${CONFIG.AUTO_KICK_REJOIN_DELAY_MS / 1000}s (5m 10s)...`);

                // Clear any existing rejoin timeout
                if (_autoRejoinTimeout) {
                    clearTimeout(_autoRejoinTimeout);
                    _autoRejoinTimeout = null;
                }

                // Schedule auto-rejoin
                _autoRejoinTimeout = setTimeout(async () => {
                    log("Auto-rejoin timer expired. Executing /start to rejoin...", "info");
                    sendNotification("⏰ **Auto-Rejoining**\nExecuting /start to rejoin the group...");

                    await executeStartWithCooldownHandling();

                    _autoRejoinTimeout = null;
                }, CONFIG.AUTO_KICK_REJOIN_DELAY_MS);

                return true;
            }
            return false;
        };

        // Check message content
        if (message.content && message.content.includes(AUTO_KICK_TITLE)) {
            searchForAutoKick(message.content, message.content);
            return;
        }

        // Check embeds
        if (message.embeds && message.embeds.length > 0) {
            for (const embed of message.embeds) {
                if (searchForAutoKick(embed.title, embed.description)) return;
            }
        }
    };

    // --- INTERNAL MODULE LOADERS ---

    const loadUserIdentity = () => {
        try {
            const userStore = BdApi.Webpack.getStore("UserStore");
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
            if (!mod) mod = BdApi.Webpack.getByKeys("subscribe", "unsubscribe", "dispatch");
            const dispatchModule = mod.dispatch ? mod : (mod.default ? mod.default : mod);

            if (!dispatchModule) throw new Error("No Dispatcher found.");
            _dispatcher = dispatchModule;

            BdApi.Patcher.after(meta.name, _dispatcher, "dispatch", (_, args) => {
                const event = args[0];
                if (event.type === 'MESSAGE_CREATE' || event.type === 'MESSAGE_UPDATE') {
                    const message = event.message || event.data;
                    if (message && message.author?.id === CONFIG.BOT_APPLICATION_ID) {
                        // Check for auto-kick DMs (no guild_id means it's a DM)
                        if (!message.guild_id) {
                            detectAutoKick(message);
                        }

                        // Handle PPM responses in the configured channel
                        if (message.channel_id === CONFIG.CHANNEL_ID) {
                            capturePPMValue(message);
                            captureStartCooldown(message);
                        }
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
            const mod = await BdApi.Webpack.waitForModule(m => m?.sendMessage && m?.receiveMessage);
            _sendMessage = mod.sendMessage;
        } catch (error) {
            log(`Failed to load Send Message module`, "error");
        }
    };

    const loadTypingModule = async () => {
        try {
            const mod = BdApi.Webpack.getByKeys("startTyping", "stopTyping");
            if (mod) {
                _typingModule = mod;
                log("Successfully loaded Typing module.", "info");
            } else {
                log("Could not find Typing module.", "warn");
            }
        } catch (error) {
            log(`Failed to load Typing module: ${error.message}`, "error");
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
        await loadTypingModule();
        return true;
    };

    // --- ANTI-IDLE SYSTEM ---

    const sendTypingIndicator = () => {
        if (!_typingModule) {
            return;
        }

        const channelsToKeepAlive = [];

        // Add private notification channel
        if (settings.notificationChannelId) {
            channelsToKeepAlive.push(settings.notificationChannelId);
        }

        // Add user notification channel if it's different
        if (settings.userNotificationChannelId &&
            settings.userNotificationChannelId !== settings.notificationChannelId) {
            channelsToKeepAlive.push(settings.userNotificationChannelId);
        }

        if (channelsToKeepAlive.length === 0) {
            return;
        }

        try {
            channelsToKeepAlive.forEach(channelId => {
                _typingModule.startTyping(channelId);
            });
            log(`Anti-idle: Sent typing indicator to ${channelsToKeepAlive.length} channel(s).`, "info");
        } catch (error) {
            log(`Error sending typing indicator: ${error.message}`, "error");
        }
    };

    const startAntiIdle = () => {
        if (!settings.antiIdle || !settings.notificationChannelId) {
            return;
        }

        if (_antiIdleInterval) {
            clearInterval(_antiIdleInterval);
        }

        log(`Anti-idle enabled: Sending typing indicator every ${CONFIG.ANTI_IDLE_INTERVAL_MS / 60000} minutes.`, "info");

        // Send immediately on start
        sendTypingIndicator();

        // Then set up interval
        _antiIdleInterval = setInterval(() => {
            sendTypingIndicator();
        }, CONFIG.ANTI_IDLE_INTERVAL_MS);
    };

    const stopAntiIdle = () => {
        if (_antiIdleInterval) {
            clearInterval(_antiIdleInterval);
            _antiIdleInterval = null;
            log("Anti-idle stopped.", "info");
        }
    };

    // --- HELPER ROLE CHECKING ---

    const hasHelperRole = () => {
        try {
            const GuildMemberStore = BdApi.Webpack.getStore("GuildMemberStore");
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

    // Send notification to user notification channel (for helper pings)
    const sendUserNotification = (message) => {
        // Use user notification channel, fallback to English channel, then regular notification channel
        const targetChannelId = settings.userNotificationChannelId || CONFIG.ENGLISH_CHANNEL_ID || settings.notificationChannelId;

        if (!_sendMessage || !targetChannelId) {
            log("Cannot send user notification: Send Message module unavailable or no channel ID set.", "warn");
            return;
        }

        try {
            _sendMessage(targetChannelId, {
                content: message,
                tts: false,
                invalidEmojis: [],
                validNonShortcutEmojis: []
            }, undefined, {});
            log(`User notification sent to channel ${targetChannelId}`, "info");
        } catch (error) {
            log(`Error sending user notification: ${error.message}`, "error");
        }
    };

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
        const totalUsers = fullData.users.length;
        const allUsersZero = fullData.users.every(u => u.ppm === 0);

        log(`Found ${usersWithZeroPPM.length} other users with 0 PPM. All users zero: ${allUsersZero}. Group ID: ${fullData.groupId || 'NOT FOUND'}`, "info");

        // Determine channel for /close_group command
        const userNotificationChannelId = settings.userNotificationChannelId || CONFIG.ENGLISH_CHANNEL_ID;

        // If ALL users have 0 PPM (dead group) and not forcing individual stops
        if (allUsersZero && fullData.groupId && !settings.forceIndividualStops) {
            log(`Dead group detected! Closing entire group: ${fullData.groupId}`, "warn");

            // Execute /close_group in user notification channel
            await executeSlashCommand(CLOSE_GROUP_COMMAND, {
                "group-id": [{ type: "text", text: fullData.groupId }]
            }, userNotificationChannelId);

            const userMentions = fullData.users.map(u => `<@${u.userId}>`).join(', ');
            const displayNames = fullData.users.map(u => `@${u.displayName || u.userId}`).join(', ');

            // Send simple notification to private channel
            sendNotification(`Whole group ${fullData.groupId} with users ${userMentions} were 0 ppm and the group has been closed.`);

            // Send TheHelperHelper-style formatted report to user notification channel
            const groupName = fullData.groupName || 'unknown';
            let report = `───────────────────────────────────\n`;
            report += `📋 Report for Group: ${fullData.groupId} (⁠${groupName})\n\n`;
            report += `Members\n`;

            fullData.users.forEach(user => {
                const statusIcon = user.ppm === 0 ? '🔴 ' : '';
                const leaderBadge = user.isLeader ? ' 👑 Leader' : '';
                const displayName = user.displayName || user.userId;
                report += `${statusIcon}${displayName}${leaderBadge} — 🎁 ${user.ppm.toFixed(2)}\n`;
            });

            report += `\n💀 Dead Group detected. Closing entire group... Please start in 5 minutes, ${displayNames}\n`;
            report += `───────────────────────────────────`;

            sendUserNotification(report);

            return;
        }

        // Otherwise, stop individual users with 0 PPM
        if (usersWithZeroPPM.length > 0) {
            log(`Stopping ${usersWithZeroPPM.length} users with 0 PPM individually...`, "info");

            const stoppedUsers = [];

            for (const user of usersWithZeroPPM) {
                log(`Stopping cluster for user ${user.userId}...`, "info");
                await executeSlashCommand(STOP_CLUSTER_COMMAND, {
                    "target": [{ type: "userMention", userId: user.userId }]
                });
                stoppedUsers.push(user.userId);
                await wait(2000); // 2-second delay between commands
            }

            const userMentions = stoppedUsers.map(id => `<@${id}>`).join(', ');

            // Send simple notification to private channel
            sendNotification(`Individual user(s) ${userMentions} were 0 and were kicked from their cluster.`);

            // Send TheHelperHelper-style formatted report to user notification channel
            const groupName = fullData.groupName || 'unknown';
            const stoppedDisplayNames = usersWithZeroPPM.map(u => `@${u.displayName || u.userId}`).join(', ');

            let report = `───────────────────────────────────\n`;
            report += `📋 Report for Group: ${fullData.groupId} (⁠${groupName})\n\n`;
            report += `Members\n`;

            fullData.users.forEach(user => {
                const statusIcon = user.ppm === 0 ? '🔴 ' : '';
                const leaderBadge = user.isLeader ? ' 👑 Leader' : '';
                const displayName = user.displayName || user.userId;
                report += `${statusIcon}${displayName}${leaderBadge} — 🎁 ${user.ppm.toFixed(2)}\n`;
            });

            report += `\n🛑 Auto-stopped cluster for ${stoppedDisplayNames}. You had 0ppm; please start again in 5 minutes.\n`;
            report += `───────────────────────────────────`;

            sendUserNotification(report);
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

            // Start anti-idle if enabled
            startAntiIdle();
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
            if (_autoRejoinTimeout) { clearTimeout(_autoRejoinTimeout); _autoRejoinTimeout = null; }

            // Stop anti-idle
            stopAntiIdle();

            if (_dispatcher) BdApi.Patcher.unpatchAll(meta.name, _dispatcher);
            if (_ppmResolve) _ppmResolve("STOPPED");
            if (_startCooldownResolve) _startCooldownResolve({ type: 'stopped' });

            BdApi.Patcher.unpatchAll(meta.name);

            // Clear notification queue
            if (_notificationQueue.length > 0) {
                log(`Cleared ${_notificationQueue.length} queued notifications.`, "info");
            }
            _notificationQueue = [];
            _notificationProcessing = false;

            _executeCommand = null;
            _dispatcher = null;
            _sendMessage = null;
            _typingModule = null;
            _ppmResolve = null;
            _startCooldownResolve = null;
            _autoRejoinTimeout = null;
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