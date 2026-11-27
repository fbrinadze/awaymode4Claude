# Away Mode for Claude Code

Step away from your desk and keep your Claude Code session moving. When Claude has a question, needs permission, finishes a task, or gets stuck, it messages you in **Microsoft Teams**, and your reply goes straight back into the session.

> **Status: pre-release.** Built on Claude Code [channels](https://code.claude.com/docs/en/channels), which are a research preview. Expect changes until v1.0.

```text
Away Mode                                        1:12 PM
[Claude · order-portal] Question
Should the export include archived orders?
Reply 1 = yes, 2 = no, or type an answer.

                                           You   1:20 PM
                                                       2

Away Mode                                        1:20 PM
[Claude · order-portal] Got it, excluding archived orders.
```

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements) and [costs](#costs)
- [Quick start](#quick-start)
- [One-time setup](#one-time-setup)
- [Using Away Mode](#using-away-mode)
- [Configuration](#configuration)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

## How it works

```text
 Your computer                               Microsoft 365 (your tenant)
┌──────────────────────────────┐            ┌─────────────────────────────┐
│ Claude Code session          │            │ Bot Connector API ──┐       │
│   ↕ stdio (MCP)              │  1 send    │                     ▼ 2     │
│ Away Mode channel server ────┼───────────►│ Teams: Away Mode bot chat   │
│   ↕                          │  4 poll    │                     │ 3 reply│
│ state.json                   │◄───────────┼── Microsoft Graph ◄─┘       │
└──────────────────────────────┘            └─────────────────────────────┘
```

- **Messages come from a bot**, not from you, so they buzz your phone like any other chat.
- **Every connection starts on your computer.** No open ports, tunnels, or hosted servers.
- **Zero cost when you're at your desk.** Teams is only checked while away mode is on.

## Requirements

| | |
| --- | --- |
| Claude Code | v2.1.234 or later, signed in with a claude.ai account or a Console API key (channels aren't available on Bedrock, Vertex, or Foundry) |
| Runtime | [Bun](https://bun.sh) 1.1 or later |
| Microsoft 365 | A work account with Teams, and the [one-time setup](#one-time-setup), done by you or your IT admin |
| Claude Team / Enterprise | An Owner must turn on **Channels** in [Organization settings → Claude Code](https://claude.ai/admin-settings/claude-code) |

### Costs

Away Mode itself is free and runs entirely on your computer. There's nothing to host.

| Item | Cost |
| --- | --- |
| Away Mode plugin | Free (MIT) |
| Azure Bot | Free. Teams is a [standard channel](https://azure.microsoft.com/en-us/pricing/details/bot-services/) with unlimited messages. You need an Azure subscription to create the bot, but Away Mode deploys no web app, so nothing is billed |
| Entra app registration, Microsoft Graph | Free. Reading your own chat isn't a [metered Teams API](https://learn.microsoft.com/en-us/graph/teams-licenses) |
| Microsoft Teams | Your existing Microsoft 365 license |
| Claude usage | Normal usage on your plan or API key. Claude keeps working while you're away, which is the point. Checking Teams uses no tokens; only your replies enter the conversation |

## Quick start

**Windows, as a Teams admin (or for yourself if you are one):**

**1. Run the installer** from a copy of this repo, in PowerShell:

```powershell
git clone https://github.com/fbrinadze/awaymode4Claude.git
cd awaymode4Claude
powershell -ExecutionPolicy Bypass -File setup\install.ps1
```

It checks for the Azure CLI, Bun and Claude Code (installing Bun if needed) and creates or reuses the Azure app and free bot. It then puts the Away Mode app in your Teams, installs the plugin, and saves its settings. The bot secret goes straight into your OS keychain and is never shown. It's safe to run again.

**2. Open a new terminal and start Claude Code with the channel on:**

```bash
claude --dangerously-load-development-channels plugin:away-mode@awaymode
```

If your organization has [approved the plugin](#one-time-setup), `claude --channels plugin:away-mode@awaymode` works too.

**3. Pair once:** run `/away-mode:setup`. Sign in with the short code it shows, then reply `hi` to Away Mode in Teams.

**4. Step away:** say so in plain words, for example *"going to lunch, back at 1:30"*.

Not a Teams admin, or on macOS/Linux? Use the [manual setup](#one-time-setup).

## One-time setup

The installer above does all of this on Windows. To do it by hand (about 10 minutes, with the Azure CLI), or on macOS/Linux, follow [docs/SETUP.md](docs/SETUP.md):

1. **Create the app and bot.** Run `setup/create-app.ps1` (Windows) or `setup/create-app.sh` (macOS/Linux). It creates or reuses one Entra app registration and a free Azure Bot, and prints the three values.
2. **Add the Teams app.** If your Teams allows it: **Apps → Manage your apps → Upload a custom app** and pick `away-mode-teams.zip`. Many organizations turn that off. In that case an admin publishes it, as described in [docs/SETUP.md](docs/SETUP.md#tenant-notes).
3. **Install the plugin.** Run `/plugin marketplace add fbrinadze/awaymode4Claude`, then `/plugin install away-mode@awaymode`. Enter the three values under `/plugin` → Away Mode.
4. **Allow the channel plugin (Team/Enterprise, optional).** This lets you start with `--channels` instead of the development flag:

```json
{
  "channelsEnabled": true,
  "allowedChannelPlugins": [
    { "marketplace": "awaymode", "plugin": "away-mode" }
  ]
}
```

Microsoft permissions requested (delegated, per user, no admin consent needed): `User.Read`, `Chat.Read`, `TeamsAppInstallation.ReadWriteSelfForUser`, plus the `offline_access` sign-in scope so you stay signed in. No tenant-wide or application Graph permissions are requested.

## Using Away Mode

**Turn it on** by saying so in plain words: *"going to lunch, back at 1:30"*, *"done for the day"*. Or use a command:

| Command | What it does |
| --- | --- |
| `/away-mode:away [1h \| until 5pm]` | Turn away mode on. Default length: 9 hours |
| `/away-mode:back` | Turn it off and list anything you missed |
| `/away-mode:status` | Show whether you're away and what's waiting |
| `/away-mode:setup` | Sign in, pair, or re-pair |

Typing anything in the terminal also ends away mode.

**What you'll get in Teams:** questions, permission requests, a short note when a task finishes, and errors. While you're away, hooks make sure of it: Claude's terminal question dialog is redirected to Teams, Claude sends a summary before it stops, and API errors (like rate limits) are reported. Typing anything in the terminal turns away mode off and Claude lists what you missed.

**How to reply:**

| You type | What happens |
| --- | --- |
| `2`, or any text, while a question is open | Answers that question |
| `yes kfmpq` / `no kfmpq` | Approves or denies that one action. A bare `yes` or `no` works when only one action is waiting |
| Anything, when nothing is open | Sent to Claude as a new instruction |
| `#q2 use last month` | Answers an older question |
| `status` / `back` | Shows progress, or ends away mode from your phone |

**Passwords and keys never go through Teams.** If Claude needs one, the bot tells you to go back to your Claude Code session. A reply that looks like a key or token is held back, not passed to Claude.

## Configuration

Change these in `/config` at any time.

| Setting | Default | Description |
| --- | --- | --- |
| `away_hours` | `9` | How long away mode lasts when you don't say |
| `end_of_day_action` | `park` | With no reply after `wait_minutes`: `park` pauses the task, `safest` continues with the safest option and tells you |
| `wait_minutes` | `60` | How long to wait for a reply before `end_of_day_action` applies |
| `never_relay` | `rm -rf`, `git push --force`, `deploy` | Commands that can only be approved at the terminal. Teams tells you one is waiting, but can't approve it |

## Security

- **Only you get through.** Messages are accepted only from the Microsoft account that paired with the bot. Everything else is dropped.
- **Approvals are explicit.** Only `yes <id>` or `no <id>` for an open request counts, and each approval covers one action.
- **Secrets stay out of Teams.** Credential requests are blocked on the way out, and anything that looks like a key is blocked on the way in.
- **Minimal access.** Three delegated Microsoft permissions, tokens kept in your OS keychain, nothing logged.
- **Small surface.** No runtime dependencies, no inbound network listener.

To report a vulnerability, see [SECURITY.md](SECURITY.md). Please don't open a public issue.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "blocked by org policy" at startup | An Owner needs to turn on Channels for your Claude organization |
| "not on the approved allowlist" | Use the development flag, or ask your admin to add Away Mode to `allowedChannelPlugins` |
| No Teams message | Run `/away-mode:status`. Check that away mode is on and that the session is still running. A sleeping laptop stops the session |
| Sign-in blocked | Your tenant may block device-code sign-in. Browser sign-in is planned but not available yet |
| "isn't added in Teams yet" | Upload `away-mode-teams.zip` in Teams (**Apps → Manage your apps**), then run `/away-mode:setup` again |
| "sign-in has expired" | Run `/away-mode:setup` again. Microsoft ends idle sign-ins after a while, or when your password changes |
| Reply not picked up | Make sure you're replying in the **Away Mode** chat, not your own notes |

## Roadmap

- [x] v0.1: Teams, two-way replies, permission relay
- [ ] Several sessions away at once, routed by project
- [ ] Listing in Anthropic's plugin directory

## Status

Pre-release (v0.1.0, unreleased). See [CHANGELOG.md](CHANGELOG.md).

## Contributing

Issues and PRs are welcome. This project stays small on purpose. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first:

- Zero runtime dependencies. Adding one needs a strong reason.
- No file over 150 lines, no function over 40.
- Every change ships with a test.

```bash
bun install          # dev tools only: TypeScript and Bun types
bun run check        # typecheck, tests, manifest validation
```

## License

[MIT](LICENSE)

Away Mode is a community project and isn't affiliated with Anthropic or Microsoft.
