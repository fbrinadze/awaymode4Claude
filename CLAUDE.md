# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Away Mode**: a Claude Code plugin that relays questions, permission prompts, finished-task notes and errors to Microsoft Teams while the user is away, and pushes their Teams replies back into the session. It is built on Claude Code **channels** (research preview).

**Status: pre-code.** Only manifests, config and docs exist so far. `docs/PLAN.md` is the approved design and the source of truth for layout, phases and behaviour. Read it before building anything, and tick its checklists as phases land. Each phase ends with a **Check** that must pass before the next one starts.

## Commands

Runtime is **Bun** (TypeScript run directly, no build step).

```bash
bun install                      # dev tools only (typescript, @types/bun)
bun run check                    # typecheck + tests + strict manifest validation; run before any PR
bun run typecheck                # tsc --noEmit
bun test                         # all tests under test/
bun test test/<file>.test.ts     # one file
bun test -t "<name pattern>"     # tests matching a name
bun run validate                 # claude plugin validate --strict on marketplace (.) and plugin (./plugin)
```

## Layout: two manifests, one install boundary

- Repo root is the **`awaymode` marketplace** (`.claude-plugin/marketplace.json`). `plugin/` is the **`away-mode` plugin**, which is the only folder copied to users' machines. Tests, docs, CI and admin scripts (`setup/`) must stay **outside `plugin/`**.
- `plugin/.claude-plugin/plugin.json` declares the stdio MCP server (`bun ${CLAUDE_PLUGIN_ROOT}/server/index.ts`), the channel, and `userConfig`. User settings reach the server only as `AWAY_*` env vars (`AWAY_TENANT_ID`, `AWAY_BOT_ID`, `AWAY_BOT_SECRET`, `AWAY_HOURS`, `AWAY_WAIT_MINUTES`, `AWAY_END_OF_DAY_ACTION`, `AWAY_NEVER_RELAY`). If you add a setting, add it in both places.
- Plugin/marketplace names must not start with `claude-` (reserved).

## Architecture (planned, see `docs/PLAN.md` "Architecture" and "Repository layout")

- **Channel server** (`plugin/server/`): a hand-rolled stdio JSON-RPC MCP server (`mcp.ts`, **not** the MCP SDK) that declares `claude/channel` and `claude/channel/permission`, exposes `ask` and `notify` tools, relays permission prompts, and routes replies.
- **Adapters** (`server/adapters/`): an interface with `send()`, `poll()` and `me()`. Teams = Bot Connector REST to send (bot client-credentials token) plus Microsoft Graph delegated `Chat.Read` polling of the bot chat. Another platform must be **one new adapter file**. If it needs changes elsewhere, the interface is wrong.
- **No inbound network listener, ever.** Replies arrive by polling, and only while away mode is on (backoff from 5 s to 60 s). No card buttons, because they'd need a bot web endpoint.
- **Hooks** (`plugin/hooks/hook.ts`): `PreToolUse` (redirect `AskUserQuestion` to `ask` while away), `Stop` (make sure a finished note goes out), `StopFailure` (error alert), `UserPromptSubmit` (terminal input ends away mode). Hooks **import nothing** and must exit in under 50 ms when away mode is off.
- **State**: `${CLAUDE_PLUGIN_DATA}/state.json`, shared by the server and the hooks.
- **Skills**: `away`, `back`, `setup`, `status` in `plugin/skills/`.

## Security invariants (tests must cover these)

- Gate on the sender's **Entra object ID**, never the chat ID. Drop everything else silently.
- Reply matching order: permission verdict, then open question, then new instruction. Only `yes|no <live 5-letter id>` approves (a bare yes/no only when exactly one request is open). One approval covers one call. `never_relay` patterns are terminal-only.
- `server/sensitive.ts`: outgoing credential requests are replaced with the fixed "Sensitive request" text, and incoming secret-looking replies (`sk-`, `ghp_`, `xox`, `AKIA`, JWTs, `-----BEGIN`, long random strings) never reach Claude. When unsure, block.
- The bot secret and refresh token live in the OS keychain (`sensitive` userConfig), with a 0600 file in plugin data as fallback. Never in the repo or logs.
- Microsoft scopes are exactly `User.Read`, `Chat.Read`, `TeamsAppInstallation.ReadWriteSelfForUser`. Don't widen them.

## Contributor rules (from README and PLAN)

- **Zero runtime dependencies.** Plain `fetch` for Microsoft APIs: no MSAL, no Bot Framework SDK, no MCP SDK. Adding a dependency needs a strong written reason.
- **No file over 150 lines, no function over 40.** Split by job, not by layer.
- Every change ships with a test. Use the fake adapter, not live Microsoft calls.
- tsconfig is strict, with `noUncheckedIndexedAccess` and `verbatimModuleSyntax` (use `import type` for types) and `.ts` extensions allowed in imports.
