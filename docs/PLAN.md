# Away Mode: Design and Build Plan

Status: approved design, pre-code. Last updated 26 Nov 2026.

## Summary

**Away Mode** is an open-source Claude Code plugin. When you tell Claude you're stepping away, it sends its questions, permission requests, finished-task notes and errors to you as Microsoft Teams messages, and your reply goes straight back into the running session.

It's built on Claude Code [channels](https://code.claude.com/docs/en/channels): a small local server that pushes your Teams replies into the session and can relay permission prompts. There's no cloud service to host. Everything runs on the user's machine.

### Decisions

| Decision | Choice |
| --- | --- |
| Reply flow | Two-way: answer questions and approve or deny actions from Teams. There is no send-only mode |
| Triggers | Claude has a question · needs permission · task finished · error or stuck |
| Platforms | Teams first; Slack later, as one new adapter file |
| Audience | Public repo; anyone can install it with their own Microsoft tenant. Set up by one person for their own session, or by an IT admin once for a team |
| Plugin / marketplace names | `away-mode` / `awaymode` (names starting with `claude-` are reserved by Anthropic) |
| Runtime | Bun, TypeScript, no build step, **zero runtime dependencies** |
| Repo | [github.com/fbrinadze/awaymode4Claude](https://github.com/fbrinadze/awaymode4Claude) |

### Design rules

1. **Lean.** Zero runtime dependencies. No build step, no database, no web framework. No file over 150 lines, no function over 40.
2. **Secure by default.** Only your own Teams account can talk to the session. Secrets live in the OS keychain. Microsoft permissions are as narrow as possible. Nothing listens on a network port.
3. **Performant.** Zero cost while you're at your desk. Teams is only polled while you're away, with backoff.
4. **Anyone can use it.** One admin step per company and one sign-in per user, with clear docs.

#### Why zero dependencies

The official MCP SDK pulls in 91 packages and 29 MB, mostly web-server code (Express, Hono, CORS) this plugin never uses. Away Mode needs only the stdio slice of the protocol: `initialize`, `tools/list`, `tools/call`, and three channel notifications. `server/mcp.ts` implements that in about 90 lines of JSON-RPC. Results: no install step on users' machines, faster startup, and no third-party supply chain. The cost is that we track MCP protocol changes ourselves, which is acceptable for this small slice.

## How it works for you

1. **Start the session** with `claude --channels plugin:away-mode@awaymode`. A shell alias such as `cc-away` saves typing.
2. **Step away.** Type something natural like "I'm going to lunch, back at 1:30" or "done for the day", or use `/away-mode:away 1h`. Claude confirms: "Away mode on until 1:30 PM. I'll message you on Teams."
3. **Claude keeps working.** When it needs you, the Away Mode bot sends a Teams message that buzzes your phone: a question, a permission request, a finished-task summary, or an error.
4. **Reply in Teams** from your phone or laptop. The answer lands in the session within a few seconds and Claude carries on.
5. **Come back.** Typing anything in the terminal ends away mode, and so does `/away-mode:back`. Claude lists anything you missed.

For **end of day**, a setting decides what Claude does after a set wait with no reply: pause and park the task (default), or continue with the safest option and say so.

## Replying in Teams

Messages come from the Away Mode bot, not from you, so they buzz your phone and never land in your notes-to-self chat.

```text
Away Mode                                        1:12 PM
[Claude · order-portal] Question
Should the export include archived orders?
Reply 1 = yes, 2 = no, or type an answer.

                                           You   1:20 PM
                                                       2

Away Mode                                        1:20 PM
[Claude · order-portal] Got it, excluding archived orders.

Away Mode                                        1:34 PM
[Claude · order-portal] Permission needed
Bash: npm run migrate
Reply "yes kfmpq" or "no kfmpq".

                                           You   1:35 PM
                                                     yes
```

| You type | What happens |
| --- | --- |
| `2`, or any text, while a question is open | Becomes the answer to that question |
| `yes kfmpq` / `no kfmpq` | Approves or denies that one action. A bare `yes` or `no` works when exactly one action is waiting |
| Anything else, when nothing is open | Goes to Claude as a new instruction |
| `#q2 use last month` | Answers an older question when more than one is open |
| `status` or `back` | Shows what Claude is doing, or ends away mode from your phone |

The bot acknowledges every reply ("Got it") within a few seconds.

## Architecture

Every connection starts on your computer, so nothing is exposed.

```text
 Your computer                                Microsoft 365 (your tenant)
┌───────────────────────────────┐            ┌──────────────────────────────┐
│ Claude Code session           │            │ Bot Connector API            │
│  hooks · permission prompts   │            │  posts as the Away Mode bot  │
│        ↕ stdio (MCP)          │  1 send    │             │ 2 notify       │
│ Away Mode channel server ─────┼───────────►│             ▼                │
│  ask/notify · sender gate     │            │ Teams on your phone          │
│  polls only while away        │  4 poll    │             │ 3 you reply    │
│        ↕                      │◄───────────┼─ Microsoft Graph (Chat.Read) │
│ state.json                    │            │                              │
└───────────────────────────────┘            └──────────────────────────────┘
```

| Part | Claude Code feature it uses | Job |
| --- | --- | --- |
| Channel server | stdio MCP server declaring `claude/channel` and `claude/channel/permission` | Pushes your replies in, relays permission prompts, exposes `ask` and `notify` |
| Hooks | `PreToolUse`, `Stop`, `StopFailure`, `UserPromptSubmit` | Redirect questions, make sure a finished note goes out, alert on API errors, end away mode when you're back |
| Skills | `away`, `back`, `setup`, `status` | Natural-language on/off, guided setup |
| State file | `${CLAUDE_PLUGIN_DATA}/state.json` | Shared by server and hooks; survives plugin updates |

## Teams connection

Messages go out from a small Teams bot. Replies come back by polling that bot chat through Microsoft Graph. Nothing ever reaches into the user's machine.

The bot matters because Teams doesn't notify you about messages you send yourself.

1. **Out:** the plugin gets a bot token (client-credentials flow) and posts to the Bot Connector REST API using the user's Entra object ID. The conversation is created once and its ID reused ([proactive messages](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages)).
2. **Back:** while away, the plugin reads new messages in that chat with delegated `Chat.Read`, filtering on `lastModifiedDateTime` so each poll returns only what's new ([list chat messages](https://learn.microsoft.com/en-us/graph/api/chat-list-messages)).
3. **No inbound endpoint:** no tunnel, no public URL, no cloud function.

### Setup

- **Once, by the user or an IT admin:** one Entra app registration, an Azure Bot on it, and the Teams app package. `setup/create-app.ps1` / `.sh` does it. The user uploads the package as a custom app in Teams, or an admin publishes it to the org catalog and users click **Add**.
- **Each user, once:** device-code sign-in from the `setup` skill. It finds the bot chat among the user's installed apps (it never installs anything, so no catalog permission is needed).

A Teams Workflows webhook would avoid the admin step, but it can only send, never receive, so it's out.

### Microsoft permissions

| Permission | Type | Why |
| --- | --- | --- |
| `User.Read` | Delegated | Get your own object ID so the bot can find you |
| `Chat.Read` | Delegated | Read your replies in the bot chat |
| `TeamsAppInstallation.ReadWriteSelfForUser` | Delegated | Find the bot chat among your installed apps during setup |
| `offline_access` | Sign-in scope | A refresh token, so you stay signed in. Not a Graph permission |
| Bot credentials | Application (bot only) | Send messages as the bot. No tenant-wide Graph access |

### Alternatives rejected

- **Graph only, posting as yourself:** no notifications.
- **Hosted bot with an inbound webhook:** someone has to run and secure a public server.
- **One shared app run by the maintainer:** the bot secret can't ship in a public repo, and every company would trust a third party.

## Triggers and message design

| Trigger | How it's caught | What you get | How you reply |
| --- | --- | --- | --- |
| Question | While away, a `PreToolUse` hook on `AskUserQuestion` denies the terminal dialog and tells Claude to use `ask` | The question, numbered options if any | `2`, or free text |
| Permission | Channel [permission relay](https://code.claude.com/docs/en/channels-reference#relay-permission-prompts); Claude Code sends a 5-letter request ID | Tool, description, command or path | `yes <id>` / `no <id>` |
| Task finished | `Stop` hook: if away and no update was sent this turn, block once and ask Claude to `notify` a summary | Two or three lines | Optional new instruction |
| Error or stuck | `StopFailure` hook sends directly; Claude also calls `notify` type `error` | What failed and what Claude is doing | Optional guidance |

### Message rules

- Every message starts with `[Claude · <project>]`, or just `[Claude]` when Claude Code was started in the home folder.
- Plain text, capped at about 1,200 characters.
- One open question at a time per session; `#<id> answer` targets an older one.
- Replies are matched in order: permission verdict, then open question, then new instruction. Nothing but an exact verdict counts as an approval.
- No card buttons in v1: button clicks need a bot web endpoint, which this design deliberately doesn't run.

## Safety and security

The whole model rests on one rule: **only the signed-in user's own Teams account gets through.**

| Risk | Control |
| --- | --- |
| Someone else messages the bot | Gate on the sender's Entra object ID, never the chat ID. Everything else is dropped silently |
| Prompt injection through replies | Replies arrive as user input inside Claude's `<channel>` tag. Only "yes" or "no" plus a live request ID counts as an approval |
| Approving something dangerous from a phone | Every prompt shows the actual command or path. `never_relay` patterns can only be approved at the terminal. One approval covers one call |
| Leaked secrets | Bot secret and refresh token in the OS keychain (`sensitive` userConfig), or a 0600 file in the plugin data folder as fallback. Never in the repo or logs |
| Too much Microsoft access | Three delegated scopes only. No `Chat.Read.All`, no application Graph permissions |
| Forgotten away mode | Always has an end time (default 9 h) and ends when you type at the terminal |
| No reply | Unanswered permission prompts expire with the local dialog. After the wait, Claude parks the task rather than guess on risky steps |
| Supply chain | Zero runtime dependencies. Dev tools pinned with a lockfile. CI runs `claude plugin validate --strict`, typecheck and tests. Signed release tags |

### Sensitive information never goes through Teams

If Claude needs a password, key or other credential, the bot sends only:

```text
Away Mode                                        2:05 PM
[Claude · order-portal] Sensitive request
Claude needs information that can't be shared over Teams.
Please go back to your Claude Code session to continue.
```

Three layers, in `server/sensitive.ts` (~40 lines):

1. **Claude is told the rule.** Channel instructions and the `away` skill forbid asking for secrets via `ask` or `notify`; Claude uses `notify` type `sensitive`, which sends only the fixed text.
2. **Outgoing check in code.** Any `ask` that requests a password, passcode, PIN, API key, token, secret, private key, connection string, one-time or MFA code, or card number is replaced with the fixed text. When unsure, block.
3. **Incoming check in code.** A reply that looks like a secret (`sk-`, `ghp_`, `xox`, `AKIA`, JWTs, `-----BEGIN` blocks, long random strings) is never passed to Claude. The bot tells the user to enter it in Claude Code and consider rotating it.

The same fixed message covers terminal-only prompts: MCP sign-in and input dialogs (`elicitation_dialog`) and OAuth or device-code sign-ins for other services.

**Not in v1, on purpose:** group chats, multiple approvers, any inbound network listener.

## Repository layout

```text
awaymode4Claude/                     repo root = the "awaymode" marketplace
├── .claude-plugin/
│   └── marketplace.json             one entry: away-mode, source "./plugin"
│
├── plugin/                          ONLY what users install (about 25 KB)
│   ├── .claude-plugin/
│   │   └── plugin.json              manifest, channel, settings, MCP server
│   ├── server/
│   │   ├── index.ts       ~120      channel server: ask/notify tools, permission relay, reply routing
│   │   ├── mcp.ts          ~90      minimal stdio JSON-RPC for MCP (replaces the SDK)
│   │   ├── state.ts        ~60      away state in ${CLAUDE_PLUGIN_DATA}/state.json
│   │   ├── poll.ts         ~50      poll loop: only while away, with backoff
│   │   ├── auth.ts         ~90      device-code sign-in, token refresh, bot token (plain fetch)
│   │   ├── sensitive.ts    ~40      blocks credential requests out and secrets in
│   │   └── adapters/
│   │       ├── adapter.ts  ~20      interface: send(), poll(), me()
│   │       └── teams.ts   ~140      Bot Connector send + Graph chat poll
│   ├── hooks/
│   │   ├── hooks.json
│   │   └── hook.ts         ~90      PreToolUse, Stop, StopFailure, UserPromptSubmit; no imports
│   └── skills/
│       ├── away/SKILL.md
│       ├── back/SKILL.md
│       ├── setup/SKILL.md
│       └── status/SKILL.md
│
├── setup/                           for admins, never installed
│   ├── create-app.ps1 / .sh         app registration + Azure Bot (az CLI)
│   └── teams-app/                   manifest.json template, color.png, outline.png
├── test/                            bun test, never installed
├── docs/                            PLAN.md (this file), SETUP.md
├── .github/                         CI, issue templates, dependabot
├── package.json                     dev only: typescript, @types/bun, scripts
├── tsconfig.json                    strict
└── README.md · CONTRIBUTING.md · SECURITY.md · CHANGELOG.md · LICENSE
```

Claude Code copies a plugin's whole folder to each user's machine, so tests, docs, CI and admin scripts stay outside `plugin/`. Hooks import nothing, so they start in milliseconds.

### Contributor rules

- Zero runtime dependencies. Adding one needs a strong, written reason.
- No file over 150 lines, no function over 40. Split by job, not by layer.
- Plain `fetch` for Microsoft APIs. No MSAL or Bot Framework SDK.
- Hooks exit in under 50 ms when away mode is off.
- Slack arrives as one new file in `adapters/`. If it needs changes elsewhere, the interface is wrong.
- Every change ships with a test.

## Build plan

Each phase ends with a check that must pass before the next starts.

### Phase 0: Spike the Teams loop (1–2 days)

- [ ] Register a test Entra app + Azure Bot; upload a bare Teams app to the org catalog
- [ ] Send a proactive message from a script using only the Bot Connector REST API
- [ ] Read the reply with delegated `Chat.Read` in the bot chat
- [ ] Confirm what the user sees in Teams when the bot's web endpoint isn't reachable
- [ ] Turn on channels for the org (Owner setting) and run a hello-world channel with the development flag

**Check:** a reply typed on a phone reaches a local script in under 10 seconds. If the endpoint test fails, switch to plan B (see risks).

### Phase 1: Core channel, platform-neutral

- [x] `mcp.ts`: stdio JSON-RPC, `initialize`, `tools/list`, `tools/call`, channel notifications
- [x] `index.ts`: channel + permission capabilities, `ask` and `notify`, reply routing
- [x] `state.ts` and `poll.ts` with backoff (5 s after a message, easing to 60 s when quiet)
- [x] Sender gate and verdict parsing, with tests for every reply rule
- [x] Fake adapter for tests

**Check:** `bun test` covers question, permission, finished and error flows end to end.

### Phase 2: Teams adapter and setup

- [x] `adapters/teams.ts` and `auth.ts` (plus `http.ts`, and `secrets.ts` using `Bun.secrets` with a 0600-file fallback)
- [x] `setup/create-app` scripts and Teams app manifest template
- [x] `setup` skill: sign-in, find the bot chat, store the chat ID, test message, pair on "hi"
- [x] Live check, passed 26 Nov 2026: pairing, then from a phone a question, a permission (`yes <id>`), a finished note and `back`. It also answered Phase 0's open question: replies reach Claude with no bot endpoint
- [x] Setup made one command: `setup/install.ps1` (Azure app and bot, Teams publish/availability/install, plugin install and configure), re-runnable `create-app`, and pairing that survives a closed session

**Check:** a real round trip from a phone works for a question, a permission and a finished task.

### Phase 3: Away experience and hooks

- [x] `away`, `back` skills (brought forward: plain "going away" didn't turn away mode on in the live check)
- [ ] `status` skill
- [ ] `hook.ts`: question redirect, finished summary, API-error alert, auto-back
- [ ] End-of-day policy, `never_relay`, sensitive-request guard (both directions)

**Check:** all four triggers fire only while away; hooks add under 50 ms when off.

### Phase 4: Harden and release v0.1.0

- [ ] Reply edge cases: verdict typos, replies after you're back, replies when nothing is open
- [ ] `docs/SETUP.md` (admin + user), `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE`
- [ ] CI on Windows, macOS, Linux: validate `--strict`, typecheck, tests; signed tags; issue templates
- [ ] Plugin icon (512–2048 px square PNG) for a future directory listing
- [ ] Tag v0.1.0

**Check:** someone in a different Microsoft tenant installs it from the docs alone in under 15 minutes.

### Phase 5: Slack

- [ ] `adapters/slack.ts` using Socket Mode (outgoing websocket, still no public endpoint)
- [ ] Slack app manifest in `setup/`

**Check:** Phase 1 tests pass against the Slack adapter, and nothing outside `adapters/` and config changed.

## Risks and open questions

| Risk or question | Impact | Plan |
| --- | --- | --- |
| Channels are a [research preview](https://code.claude.com/docs/en/channels#research-preview). Custom channels need `--dangerously-load-development-channels` unless on Anthropic's allowlist or the org's `allowedChannelPlugins` | High | Document both paths. Admins add `away-mode` to `allowedChannelPlugins`. Apply for an Anthropic directory listing after v0.1. Keep channel code in one file |
| Team/Enterprise orgs block channels until an Owner enables them; not on Bedrock, Vertex or Foundry | Medium | State requirements up front. The setup skill checks and stops with a clear message |
| ~~Unverified: what Teams shows when the bot endpoint is unreachable~~ | Resolved | Live check, 26 Nov 2026: replies post to the chat and reach Claude through Graph with a placeholder endpoint. Plan B not needed |
| Tenants block custom app upload, and the admin center's availability page can fail | Medium | `install.ps1` publishes with the Teams PowerShell module and sets availability and installs with `Update-M365TeamsApp`; docs/SETUP.md "Tenant notes" covers doing it by hand |
| The session only runs while the computer is awake | Medium | Warn on end-of-day away mode; suggest an OS keep-awake option |
| Several sessions away at once read the same chat | Medium | v1: one away session at a time (lock file). v2: route by project tag |
| Some tenants block device-code sign-in | Medium | Fall back to browser sign-in with PKCE and a localhost redirect |
| Hand-written MCP layer must track protocol changes | Low | Small surface, covered by tests; pin the protocol revision Claude Code accepts for channels |
| Overlap with Claude Code [Remote Control](https://code.claude.com/docs/en/channels#how-channels-compare) | Low | Different job: Remote Control needs the Claude app; Away Mode meets you in Teams |

## Costs

| Item | Cost |
| --- | --- |
| Away Mode | Free (MIT), runs locally, nothing to host |
| Azure Bot | Free: Teams is a [standard channel](https://azure.microsoft.com/en-us/pricing/details/bot-services/) with unlimited messages; no web app deployed |
| Entra app, Microsoft Graph | Free; per-chat message reads aren't [metered](https://learn.microsoft.com/en-us/graph/teams-licenses) |
| Teams | Existing Microsoft 365 license |
| Claude usage | Normal plan or API usage; polling uses no tokens, only replies enter the conversation |

## Sources

Checked 26 Nov 2026.

- [Claude Code: Channels](https://code.claude.com/docs/en/channels)
- [Claude Code: Channels reference](https://code.claude.com/docs/en/channels-reference)
- [Claude Code: Hooks reference](https://code.claude.com/docs/en/hooks)
- [Claude Code: Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)
- [Claude Code: Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference)
- [Microsoft: Send proactive messages](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages)
- [Microsoft Graph: List messages in a chat](https://learn.microsoft.com/en-us/graph/api/chat-list-messages)
- [Microsoft Graph: Teams API licensing and metering](https://learn.microsoft.com/en-us/graph/teams-licenses)
- [Azure Bot Service pricing](https://azure.microsoft.com/en-us/pricing/details/bot-services/)
