# Away Mode for Claude Code

[![CI](https://github.com/fbrinadze/awaymode4Claude/actions/workflows/ci.yml/badge.svg)](https://github.com/fbrinadze/awaymode4Claude/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/fbrinadze/awaymode4Claude)](https://github.com/fbrinadze/awaymode4Claude/releases)
[![License](https://img.shields.io/github/license/fbrinadze/awaymode4Claude)](LICENSE)
![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757)
![Microsoft Teams](https://img.shields.io/badge/Microsoft%20Teams-6264A7?logo=microsoftteams&logoColor=white)
[![Teams admin: not required](https://img.shields.io/badge/Teams%20admin-not%20required-success)](docs/SETUP.md)
[![Vacation mode](https://img.shields.io/badge/vacation%20mode-v1.3-8A2BE2)](#vacation-mode)

Step away from your desk and keep your Claude Code session moving. When Claude has a question, needs permission, finishes a task, or gets stuck, it messages you in **Microsoft Teams**. Your reply goes straight back into the session.

> **Status: v1.3.0.** Stable on Windows with Microsoft Teams. It is built on Claude Code [channels](https://code.claude.com/docs/en/channels), which are a research preview, so Claude Code needs a launch flag (see [Quick start](#quick-start)). See [CHANGELOG.md](CHANGELOG.md).

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
- [Several projects at once](#several-projects-at-once)
- [Vacation mode](#vacation-mode)
- [Teams commands](#teams-commands)
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
- **Every connection starts on your computer.** There are no open ports, tunnels or hosted servers.
- **Away Mode checks Teams only while you are away.** At your desk it does nothing.

## Requirements

| | |
| --- | --- |
| Claude Code | v2.1.234 or later, signed in with a claude.ai account or a Console API key. Channels aren't available on Bedrock, Vertex or Foundry |
| Runtime | [Bun](https://bun.sh) 1.1 or later. Bun runs the Away Mode server. The Windows installer installs it for you |
| Microsoft 365 | A work account with Teams, and the [one-time setup](#one-time-setup), done by you or your IT admin |
| Claude Team / Enterprise | An Owner must turn on **Channels** in [Organization settings → Claude Code](https://claude.ai/admin-settings/claude-code) |

### Costs

Away Mode is free and runs on your computer. There is nothing to host.

| Item | Cost |
| --- | --- |
| Away Mode plugin | Free (MIT) |
| Azure Bot | Free. Teams is a [standard channel](https://azure.microsoft.com/en-us/pricing/details/bot-services/) with unlimited messages. You need an Azure subscription to create the bot, but Away Mode deploys no web app, so nothing is billed |
| Entra app registration, Microsoft Graph | Free. Reading your own chat isn't a [metered Teams API](https://learn.microsoft.com/en-us/graph/teams-licenses) |
| Microsoft Teams | Your existing Microsoft 365 license |
| Claude usage | Normal usage on your plan or API key. Claude keeps working while you're away, which is the point. Checking Teams uses no tokens. Only your replies enter the conversation |

## Quick start

**Windows, as a Teams admin (or for yourself if you are one):**

1. **Run the installer** from a copy of this repo, in PowerShell:

   ```powershell
   git clone https://github.com/fbrinadze/awaymode4Claude.git
   cd awaymode4Claude
   powershell -ExecutionPolicy Bypass -File setup\install.ps1
   ```

   The installer does these things:
   - Checks for the Azure CLI, Bun and Claude Code. It installs Bun if it is missing.
   - Links Bun into `%LOCALAPPDATA%\Microsoft\WindowsApps`, a folder that is always on your PATH, so Away Mode finds Bun even in a terminal that was open before Bun was installed.
   - Creates or reuses the Azure app and the free bot.
   - Adds Away Mode to Teams for you. To add colleagues, use `-ForUsers alice@contoso.com,bob@contoso.com`.
   - Installs the plugin and saves its settings. The bot secret goes into your OS keychain and is never shown.

   It is safe to run again. Three options set the [settings](#configuration) up front: `-Sessions one`, `-ReplyRouting on` and `-CheckIns "9:00,18:00"`.

2. **Open a new terminal and start Claude Code with the channel on:**

   ```bash
   claude --dangerously-load-development-channels plugin:away-mode@awaymode
   ```

   If your organization has [approved the plugin](#for-organization-admins), `claude --channels plugin:away-mode@awaymode` also works.

3. **Pair once.** Run `/away-mode:setup`. Sign in with the short code it shows, then reply `hi` to Away Mode in Teams.

4. **Step away.** Say so in plain words, for example *"going to lunch, back at 1:30"*.

**Two routes to Teams.** The **bot route** needs a Teams admin to add the Away Mode app. The **workflow route** doesn't: a small Power Automate flow that you make sends the messages, and your own sign-in reads your replies. No Teams admin and no Azure subscription. Run `setup\install.ps1 -Route workflow` and follow [No Teams admin? Use the workflow route](docs/SETUP.md#no-teams-admin-use-the-workflow-route). Without `-Route`, the installer asks.

On macOS or Linux? Use the [manual setup](#one-time-setup).

## One-time setup

The installer does all of this on Windows. To do it by hand (about 10 minutes, with the Azure CLI), or on macOS or Linux, follow [docs/SETUP.md](docs/SETUP.md):

1. **Create the app and bot.** Run `setup/create-app.ps1` (Windows) or `setup/create-app.sh` (macOS or Linux). It creates or reuses one Entra app registration and a free Azure Bot, and prints three values.
2. **Add the Teams app.** If your Teams allows it, go to **Apps → Manage your apps → Upload a custom app** and pick `away-mode-teams.zip`. Many organizations turn that off. Then an admin publishes the app, as described in [docs/SETUP.md](docs/SETUP.md#tenant-notes).
3. **Install the plugin.** Run `/plugin marketplace add fbrinadze/awaymode4Claude`, then `/plugin install away-mode@awaymode`. Enter the three values under `/plugin` → Away Mode.

Microsoft permissions requested (delegated, per user, no admin consent needed). Bot route: `User.Read`, `Chat.Read` and `TeamsAppInstallation.ReadWriteSelfForUser`. Workflow route: `User.Read` and `Chat.Read` only. Both add the `offline_access` sign-in scope so you stay signed in. No tenant-wide or application Graph permissions are requested.

### For organization admins

On Claude Team or Enterprise, you can allow the plugin for everyone in your managed settings:

```json
{"channelsEnabled": true, "allowedChannelPlugins": [{"marketplace": "awaymode", "plugin": "away-mode"}]}
```

This does not remove the launch flag. **Individual users still need to start Claude Code with `--dangerously-load-development-channels plugin:away-mode@awaymode`** while channels are a research preview.

## Using Away Mode

**Turn it on** by saying so in plain words: *"going to lunch, back at 1:30"* or *"done for the day"*. Or use a command:

| Command | What it does |
| --- | --- |
| `/away-mode:away [1h \| until 5pm]` | Turns away mode on. The default length is 9 hours. For days, see [Vacation mode](#vacation-mode) |
| `/away-mode:back` | Turns it off and lists anything you missed |
| `/away-mode:status` | Shows whether you're away and what is waiting |
| `/away-mode:setup` | Signs in, pairs, or re-pairs |
| `/away-mode:doctor` | Checks why Away Mode isn't working and tells you how to fix each problem. It can send one test message to Teams, but only if you agree |

**Typing anything in the terminal ends away mode for that project.** Other projects that are away stay away. When away mode ends, Teams gets a short recap: what finished, which questions went unanswered and which approvals were cancelled.

**What you get in Teams:** questions, permission requests, a short note when a task finishes, and errors. While you're away, Claude's terminal question dialog is redirected to Teams, Claude sends a summary before it stops, and errors such as rate limits are reported.

**How to reply** (with one project away):

| You type | What happens |
| --- | --- |
| `2`, or any text, while a question is open | Answers the newest open question |
| `yes kpqrs` or `no kpqrs` | Approves or denies that one request. Each approval covers one action |
| `yes` or `no` on its own | Works only if exactly one request is waiting, no question is open, and you replied after the request arrived. Otherwise Away Mode asks which one you mean |
| `#q2 use last month` | Answers question 2, even if it is not the newest |
| Anything else, when nothing is open | Goes to Claude as a new instruction |

A request ID is five letters, like `kpqrs`. It is shown in the request message. A reply that ends in `?` is never treated as a yes. If you mistype an ID by one letter, Away Mode asks you to confirm instead of approving.

**Long commands.** A command over 600 characters can't be approved without reading it. Reply `more kpqrs` and Away Mode sends the full text in numbered parts of up to 1,000 characters. After every part is sent, `yes kpqrs` works. If the command needs more than 5 parts, it can only be approved at the terminal.

**Passwords and keys never go through Teams.** If Claude needs one, the bot tells you to go back to your session. A reply that looks like a key or token is held back and never reaches Claude.

## Several projects at once

You can be away in more than one project at the same time. Each message from Claude starts with `[Claude · <project>]`. The project name is the folder name, for example `order-portal`.

To reply to one project, start with `@` and its name:

```text
@order-portal rerun the export
```

Away Mode sends `rerun the export` to `order-portal` only. Names are not case-sensitive. If two away projects have the same folder name, Away Mode shows `parent/folder` instead. A session started in your home folder is called `home`.

More examples with `order-portal` and a second project away:

| You type | What happens |
| --- | --- |
| `yes kpqrs` | Approves request `kpqrs` in whichever project raised it. The ID is enough |
| `#q3 no` | Answers question 3 with "no" in the project that asked it |
| `@order-portal #q3 no` | Same, but only if `order-portal` asked question 3 |
| `rerun the export` | Not delivered. Away Mode replies "Which project? Start with @order-portal or @other." |
| `use last month` | Answers the question, if exactly one question is open across all away projects. Otherwise Away Mode asks which project |
| `yes` | Works only if exactly one request is waiting across all away projects, and no question is open |
| `status` | Shows every away project |
| `back`, `extend`, `until`, `snooze` | Apply to every away project, unless you start with `@name`. The reply lists which projects changed |

**Reply routing.** If you turn `reply_routing` on, you can swipe to quote one of the bot's messages and type your reply. Away Mode sends it to the project that message came from, as if you had typed `@project`. With `reply_routing` off, use `@project`.

**Two sessions in the same project.** Only one session owns the away state of a project. If you run `/away-mode:away` in the other session, it takes over that project's replies.

**One at a time.** If you prefer only one project away at once, set `sessions` to `one`. Going away in a project then ends the previous one, and Teams says so.

## Vacation mode

For days away, not hours. Say it in plain words: *"on vacation until Monday"*, *"away for a week"* or *"off for 5 days"*. Claude turns away mode on with a vacation end time. Everything in [Using Away Mode](#using-away-mode) still works: questions, approvals, notes and errors reach Teams, and your replies go back to the session.

What vacation adds:

- **Check-ins.** At the times in `vacation_checkins` (default `9:00`), the bot sends a Check-in card. It starts with `On vacation until <time>`. Then it lists what is waiting for you (approvals with their `yes <id>` / `no <id>` reply, and open questions, each with how many hours they have waited), any parked items, and how many tasks finished since the last check-in. If nothing needs you, it says `Still working. Nothing needs you.` Several times are comma-separated, for example `9:00,18:00` (`9am` and `6pm` also work). Entries it can't read are ignored, and if none are readable it uses `9:00`. After a long sleep you get one catch-up check-in, not one per missed time.
- **Approvals.** An approval waiting at a check-in can be answered from Teams as usual, with `yes <id>`. An unanswered approval follows `wait_minutes` and `end_of_day_action` like in any away period, so a long wait can cancel it. The check-in lists what is waiting at that moment.
- **Day-sized times.** `extend 2d` adds two days, and `until monday` sets the end to the next Monday (never today) at `vacation_return_time` (default `9:00`). See [Teams commands](#teams-commands).
- **Your PC stays awake.** While a project is on vacation, Away Mode asks the computer not to go to sleep (the screen may still turn off). It lets go as soon as the last vacation ends: `back`, time up, or typing at the terminal.
- **Laptops.** The computer sleeps when you close the lid unless you change that. When Away Mode finds a battery, Teams gets one note when vacation starts: *On a laptop: keep the lid open, or set 'When I close the lid: Do nothing' while plugged in.* `/away-mode:doctor` shows a `keep awake` line while a vacation is running, and repeats the lid warning on a laptop.
- **A 30-day ceiling.** No away period, vacation or not, can last longer than 30 days. A longer request is refused with "Away mode can last at most 30 days.", so a typo can't keep a PC awake for a year.

**A missed check-in means the PC or Claude Code stopped.** Check-ins come from the session on your computer. If one doesn't arrive, the PC went to sleep or off, lost its network, or Claude Code was closed. Away Mode can't send a "last gasp" from a machine that has stopped.

To end vacation early, reply `back`, run `/away-mode:back`, or type in the terminal. As with any away period, Teams gets a recap.

## Teams commands

Send these in the Away Mode chat. They must match exactly. Anything else counts as plain text. Start with `@project` to aim a command at one project.

| Command | What it does |
| --- | --- |
| `yes <id>` / `no <id>` | Approves or denies one waiting request. `y` and `n` also work |
| `#qN <text>` | Answers question N, for example `#q2 use last month` |
| `status` | Shows whether you're away and what is waiting |
| `back` | Ends away mode from your phone |
| `extend 1h` | Adds time. Use `m` or `h`, for example `extend 30m` |
| `extend 2d` | Adds whole days, for example `extend 2d` or `extend 3 days`. Up to 30 days in total |
| `until 6pm` | Sets the end time, for example `until 6pm` or `until 18:30` |
| `until monday` | Sets the end to the next Monday (or any weekday name, full or three letters, like `fri`) at `vacation_return_time`. Never today |
| `snooze 30m` | Holds back "finished" and info notes for 30 minutes. Questions, approvals and errors still arrive. Held notes appear in the recap |
| `snooze until 3pm` | Same, until the clock shows 3pm |
| `unsnooze` | Ends the snooze |
| `more <id>` | Sends the full text of a long command, so you can approve it |

`status` and `back` also work as plain words, so a bare `back` can't answer a question. Use `#q2 back` for that.

## Configuration

Change these under `/plugin` → Away Mode. The installer sets `sessions`, `reply_routing` and `vacation_checkins` for you.

| Setting | Default | Description |
| --- | --- | --- |
| `away_hours` | `9` | How long away mode lasts when you don't say (1 to 24) |
| `wait_minutes` | `60` | How long to wait for a reply before `end_of_day_action` applies (5 to 720) |
| `end_of_day_action` | `park` | With no reply after `wait_minutes`: `park` pauses the task, `safest` continues with the safest option and tells you |
| `never_relay` | `rm -rf`, `git push --force`, `deploy` | Commands that can only be approved at the terminal. Teams tells you one is waiting but can't approve it |
| `vacation_checkins` | `9:00` | Local times for vacation check-ins, comma-separated, for example `9:00,18:00` |
| `vacation_return_time` | `9:00` | The time of day an `until <weekday>` away ends |
| `sessions` | `several` | `several`: each project can be away at once. `one`: going away in a project ends the previous one |
| `reply_routing` | `off` | `on`: quoting a bot message sends your reply to that message's project. `off`: use `@project` |
| `teams_route` | `bot` | `bot`: the Away Mode Teams app (needs a Teams admin). `workflow`: a Power Automate flow (no admin) |
| `workflow_url` | none | Workflow route: the flow's HTTP URL. Sensitive: kept in your OS keychain |
| `sign_in_app` | none | Workflow route: your sign-in app's ID, or `graph-tools` |
| `tenant_id`, `bot_app_id`, `bot_secret` | none | Set by the installer. The secret is kept in your OS keychain |

## Security

- **Only you get through.** Messages are accepted only from the Microsoft account that paired with the bot. Everything else is dropped.
- **Approvals are explicit.** Each approval covers one action. A bare `yes` works only when it can't be ambiguous.
- **Secrets stay out of Teams.** Credential requests are blocked on the way out. Anything that looks like a key is blocked on the way in.
- **Minimal access.** Three delegated Microsoft permissions on the bot route (two on the workflow route), tokens kept in your OS keychain, nothing logged.
- **Small surface.** No runtime dependencies and no inbound network listener.

See [PRIVACY.md](PRIVACY.md) for what leaves your machine. To report a vulnerability, see [SECURITY.md](SECURITY.md). Please don't open a public issue.

## Troubleshooting

Start with `/away-mode:doctor`. It checks Bun, the plugin, your settings, sign-in, Teams and the state file, and says how to fix each one.

| Problem | Fix |
| --- | --- |
| "blocked by org policy" at startup | An Owner needs to turn on Channels for your Claude organization |
| "not on the approved allowlist" | Use the development flag, or ask your admin to add Away Mode to `allowedChannelPlugins` |
| Away Mode's tools are missing, or `bun` isn't found | Start Claude Code with the channel flag. On Windows, rerun `setup\install.ps1` to refresh the Bun link. If the installer said Bun wasn't linked, quit your terminal app completely and open it again |
| No Teams message | Run `/away-mode:status`. Check that away mode is on and the session is still running. A sleeping laptop stops the session |
| Sign-in blocked | Your tenant may block device-code sign-in. Browser sign-in isn't available yet |
| "isn't added in Teams yet" | Upload `away-mode-teams.zip` in Teams (**Apps → Manage your apps**), then run `/away-mode:setup` again |
| "sign-in has expired" | Run `/away-mode:setup` again. Microsoft ends idle sign-ins after a while, or when your password changes |
| Reply not picked up | Reply in the **Away Mode** chat, not your own notes. If several projects are away, start with `@project` |

## Roadmap

- [x] v0.1: Teams, two-way replies, permission relay
- [x] v1.0: one-command Windows installer, live-tested on Teams
- [x] v1.1: several sessions away at once, routed by project
- [x] v1.1: preparation for a listing in Anthropic's plugin directory (the listing itself is a separate submission)
- [x] v1.1: Teams commands `extend`, `until`, `snooze`, `more`, a recap when away mode ends, and `/away-mode:doctor`
- [x] v1.2: no Teams admin needed (the workflow route: a Power Automate flow sends, your own app reads replies)
- [x] v1.2: cards that say Claude Code and which project each message is from
- [x] v1.3: vacation mode (away for days, check-ins, the PC kept awake)

Next:

- [ ] Listing in Anthropic's plugin directory (submit the prepared plugin)
- [ ] Browser sign-in, for organisations that block device-code sign-in
- [ ] One-command installer for macOS and Linux (setup there is manual today)

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
