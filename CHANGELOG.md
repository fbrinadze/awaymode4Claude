# Changelog

All notable changes are listed here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.3.0] - 2026-11-26

### Removed
- Slack support (added in 0.2.0, never live-tested). Away Mode is Teams-only again; the code is in git history at v0.2.1 (PR #10).

## [0.2.1] - 2026-11-26

### Fixed
- The plugin manifest version now matches the release, so `claude plugin update` picks up new releases (0.1.0 and 0.2.0 both shipped as 0.1.0) (PR #9).

## [0.2.0] - 2026-11-26

### Added
- Slack over Socket Mode, with code pairing and setup docs. Not live-tested yet (PR #7, #8).

## [0.1.0] - 2026-11-26

### Added
- Teams relay: questions, permission prompts, finished-task notes and errors go to a Teams chat, and replies come back into the session (PR #1, #2).
- Setup: sign-in, finding the Away Mode bot chat, a test message and pairing (PR #2).
- One-command installer, setup fixes and plain-words away mode (PR #3).
- Hooks: questions redirected to Teams while away, finished notes guaranteed, error alerts, and terminal input ends away mode (PR #5).
- Safety: `never_relay` patterns, sensitive-information checks in both directions, end-of-day policy and a status skill (PR #5).

### Fixed
- Setup now finds Teams apps that were uploaded (sideloaded) rather than published (PR #4).
