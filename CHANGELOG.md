# Changelog

All notable changes are listed here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.1] - 2026-11-27

### Security
Fixes from a source-review security audit. Each fix comes with a test that failed before it.
- **A bare "yes" can no longer approve the wrong thing.** It counts only when exactly one request is open, no question is waiting, and the reply was sent after the request arrived. Otherwise Away Mode asks which one you meant.
- **You always see what you're approving.** The description is capped so the command and the reply line always fit, and a command too long to show in Teams stays at the terminal.
- **`never_relay` can't be dodged by respelling.** Spacing, quotes and flag order are normalised (`rm -fr`, `rm  -rf`, `rm -r -f`), and the tool name is checked too.
- **Claude can't ask for a secret through `ask` options or `notify` text**, only the question was checked before. All of them now get the fixed "Sensitive request" message.
- **Pasted keys are held back even when wrapped** in quotes, brackets, punctuation or `key:`, including Microsoft Entra secrets with `~` and `.`.
- **Only Away Mode's own `set_away` can claim a session.** Another MCP server's tool, or a failed call, no longer moves away mode to a different session.
- Hardening: the hooks ignore unreadable input instead of failing, and `setup/create-app.sh` shows the bot secret only on a live terminal, never in redirected output or CI logs.

## [1.0.0] - 2026-11-27

First stable release: the same code as 0.3.1, declared stable after live testing on Windows with Microsoft Teams.

### Verified live
- Install on Windows with `setup\install.ps1`, including a terminal that was open before Bun was installed.
- Sign-in and pairing with the Away Mode chat in Teams.
- Questions reach Teams while you're away.
- Typing at the terminal ends away mode.

### Not yet verified live
- A Teams reply leaving away mode on, the "Done" note when a task finishes, and the `AskUserQuestion` → Teams redirect. Unit tests cover all three.

## [0.3.1] - 2026-11-27

### Fixed
- Away Mode no longer needs Bun on the PATH Claude Code started with. The server and hooks run a new **Bun path** setting (default `bun`), which `setup\install.ps1` fills with Bun's full path. This fixes the server failing to start after the installer added Bun, when Windows Terminal or VS Code still had the old PATH (PR #11).

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
