# Changelog

All notable changes to PPMChecker will be documented in this file.

## [1.0.10] - 2025-11-28

### Fixed
- **BetterDiscord API Compatibility:** Updated all module lookups to use modern BetterDiscord API
  - Replaced deprecated `Filters.byProps` with `getStore()` and `getByKeys()`
  - UserStore now uses `getStore("UserStore")`
  - GuildMemberStore now uses `getStore("GuildMemberStore")`
  - Dispatcher fallback now uses `getByKeys()` instead of `Filters.byProps`
  - SendMessage module now uses custom filter function for `waitForModule`

### Added
- **Auto-Kick Detection & Auto-Rejoin:** Plugin now automatically handles being kicked for reaching 99 friends
  - Detects "Auto Kick" DM from Dreama bot
  - Waits 5 minutes 10 seconds (310 seconds) before rejoining
  - Automatically executes `/start` to rejoin the group
  - Sends notifications for kick detection and rejoin status
  - New config constant: `AUTO_KICK_REJOIN_DELAY_MS`

## [1.0.9] - 2025-01-XX

### Fixed
- Group ID parsing for `/close_group` command

## [1.0.8] - 2025-01-XX

### Added
- Cooldown detection for `/start` command
- Group-wide PPM monitoring for users with helper role
- Auto-retry logic when `/start` command is on cooldown
- `/stop_cluster` command for stopping individual user clusters
- `/close_group` command for closing entire groups when all users have 0 PPM

### Changed
- Enhanced helper role functionality for managing group-wide issues

## [1.0.0] - 2024-XX-XX

### Added
- Initial release
- Automatic PPM monitoring every 15 minutes
- User-specific status detection from `/ppm` responses
- Automated restart sequence for 0 PPM or missing users
- Cluster offline detection and recovery
- Configurable `/clear` command execution
- Restart verification with 2-minute warm-up period
- Safe timeout handling to prevent restart loops
- Notification channel configuration
- Verbose logging option
