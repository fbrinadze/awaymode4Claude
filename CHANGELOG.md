# Changelog

All notable changes are listed here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] - unreleased

### Added
- Teams relay: questions, permission prompts, finished-task notes and errors go to a Teams chat, and replies come back into the session (PR #1, #2).
- Setup: sign-in, finding the Away Mode bot chat, a test message and pairing (PR #2).
- One-command installer, setup fixes and plain-words away mode (PR #3).
- Hooks: questions redirected to Teams while away, finished notes guaranteed, error alerts, and terminal input ends away mode (PR #5).
- Safety: `never_relay` patterns, sensitive-information checks in both directions, end-of-day policy and a status skill (PR #5).

### Fixed
- Setup now finds Teams apps that were uploaded (sideloaded) rather than published (PR #4).
