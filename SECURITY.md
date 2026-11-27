# Security

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab, then **Report a vulnerability**
(fbrinadze/awaymode4Claude). Please do not open a public issue for a vulnerability.

## Security model

Only the signed-in user's own Teams account gets through. In short:

- **Sender gating.** Messages are accepted by the sender's Entra object ID, never the chat ID. Everything else is dropped silently.
- **Verdict matching.** Only `yes` or `no` plus a live 5-letter request ID approves a permission prompt (a bare yes/no only when exactly one request is open). One approval covers one call.
- **`never_relay`.** Matching patterns are terminal-only and can't be approved from Teams.
- **Sensitive information.** `server/sensitive.ts` works in both directions. Outgoing credential requests are replaced with a fixed "Sensitive request" message. Incoming replies that look like secrets never reach Claude. When unsure, it blocks.
- **Secret storage.** The bot secret and refresh token live in the OS keychain, with a 0600 file in the plugin data folder as fallback. Never in the repo or logs.
- **Microsoft scopes.** Exactly `User.Read`, `Chat.Read` and `TeamsAppInstallation.ReadWriteSelfForUser` (delegated). No wider access.
- **No inbound listener.** Replies are polled, and only while away mode is on. There is no network listener.

Details are in [docs/PLAN.md](docs/PLAN.md), "Safety and security".
