# Phase 3 Hooks and Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Away mode works without Claude's cooperation. Questions reach Teams, finished tasks and API errors are reported, typing at the terminal ends away mode, secrets never cross Teams, and `never_relay` and `end_of_day_action` take effect.

**Architecture:**
- One dependency-free hook script, `plugin/hooks/hook.ts`, with a pure `decide()` that reads and patches `state.json`.
- The server's new behaviour goes into two new modules: `sensitive.ts` (pure checks) and `relay.ts` (permission relay with `never_relay`, outbox draining, the end-of-day sweep). They're wired from `away.ts` and `tools.ts`.

**Tech Stack:** Bun + TypeScript (no runtime deps), `bun test`, Claude Code plugin hooks (exec form).

**Spec:** `C:\Users\fbrinadze\.claude\plans\atomic-wandering-quiche.md` (Phase 3, approved 2026-11-26). Background: `docs/PLAN.md`, sections "Triggers and message design" and "Safety and security".

## Global Constraints

- Zero runtime dependencies. No file over 150 lines, no function over 40.
- `hook.ts` imports nothing from the project; it uses Bun globals only. When away mode is off or `state.json` is missing, it exits at once with no output.
- The hook's JSON shapes are exactly as follows:
  - PreToolUse deny: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":…}}`.
  - Stop block: `{"decision":"block","reason":…}`.
  - UserPromptSubmit context: `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":…}}`.
- Server acks ("Got it.", "Approved.") never count as Claude having sent an update.
- Only an exact `yes|no <id>` approves. Secret-looking replies never reach Claude.
- Graph permissions are unchanged.

## Review Focus

1. **A channel event triggers `UserPromptSubmit`.** It must NOT end away mode. A prompt starting with `<channel` is ignored. Tested in Task 4.
2. **A stale `state.json` says away, in a session without the channel.** The first typed prompt ends away mode, so the hooks stop interfering. Tested in Task 4.
3. **Stop loops.** The hook never blocks when `stop_hook_active` is true, and never blocks the turn that turned away mode on. Tested in Task 4.
4. **A secret-looking reply that is also a verdict or an option number** (`yes abcde`, `2`). These must still work; `looksLikeSecret` must not flag short ordinary text. Tested in Task 1.
5. **Timeout with `wait_minutes` reached while an answer is in flight.** The sweep runs before inbound handling in the same poll, so a closed question's late answer becomes an ordinary instruction, never a crash. Tested in Task 3.

---

### Task 1: Secret checks

**Files:** Create `plugin/server/sensitive.ts`. Test `test/sensitive.test.ts`.

**Interfaces:**
- Produces: `asksForSecret(text: string): boolean`, `looksLikeSecret(text: string): boolean`, and `export const SENSITIVE_TEXT = "Sensitive request\nClaude needs information that can't be shared over Teams.\nPlease go back to your Claude Code session to continue."`

- [ ] **Step 1: Write the failing tests.**
  - `asksForSecret` is true for:
    - "What's the database password?"
    - "Please send your API key"
    - "Enter the MFA code"
    - "paste the connection string"
    - "card number?"
  - It's false for:
    - "Include archived orders?"
    - "Which token format do you prefer, JWT or opaque?" (a question about tokens, not asking for one)

    → Rule: the request wording (send, give, enter, paste, share, provide, what's/what is) must appear together with a secret noun.
  - `looksLikeSecret` is true for:
    - `sk-abc123…` (20+ characters)
    - `ghp_` followed by 36 characters
    - `AKIA` plus 16 uppercase characters or digits
    - a three-part JWT `eyJ….….…`
    - `-----BEGIN PRIVATE KEY-----`
    - a 32+ character run of mixed letters and digits with no spaces
  - It's false for:
    - `yes abcde`
    - `2`
    - `#q1 use last month`
    - `status`
    - an ordinary sentence
    - a URL like `https://example.com/a/b`
- [ ] **Step 2: Run** `bun test test/sensitive.test.ts`. Expect FAIL (module missing).
- [ ] **Step 3: Implement the two functions** with regexes, under 40 lines.
- [ ] **Step 4: Run** it again. Expect PASS. Then run `bun test`, expecting all to pass.
- [ ] **Step 5: Commit** with `feat: detect secret requests and secret-looking replies`.

### Task 2: State fields, the status tool, and secret-safe ask and notify

**Files:** Modify `plugin/server/state.ts`, `plugin/server/tools.ts` and `plugin/server/away.ts` (INSTRUCTIONS only). Test `test/flows.test.ts`.

**Interfaces:**
- Consumes: Task 1's `asksForSecret`, `SENSITIVE_TEXT`.
- Produces:
  - `State` gains `lastSentAt: number`, `lastStopAt: number`, `awayStartedAt: number` (epoch ms, default 0) and `outbox: { type: string; text: string }[]` (default `[]`).
  - Tool `status` with no arguments returns the existing status text plus each open question's ID and text.
  - `notify` accepts `type: "sensitive"`.

- [ ] **Step 1: Write the failing flows tests.**
  - `"ask and notify record that Claude sent an update"`: after `notify`, `load(dir).lastSentAt === T`. After an inbound reply's "Got it.", it is unchanged.
  - `"set_away records when away mode started"`: `awayStartedAt === T`.
  - `"status lists open questions"`: after `ask` "Include archived?", the `status` text contains "q1" and "Include archived?".
  - `"ask for a secret sends the sensitive notice instead"`: `ask` with "What's the database password?" makes the tool result contain "can't be shared over Teams", and `fake.sent[0]` is `[Claude · order-portal] ` + `SENSITIVE_TEXT`, with no question stored.
  - `"notify sensitive sends the fixed text"`.
- [ ] **Step 2: Run** `bun test test/flows.test.ts`. Expect the 5 new tests to FAIL.
- [ ] **Step 3: Implement.**
  - Add the fields to `fresh()`.
  - `ask`: if `asksForSecret`, say `SENSITIVE_TEXT` and return a refusal; otherwise send as before. In both cases set `lastSentAt`.
  - `notify`: add `sensitive` to `HEADERS` (it sends `SENSITIVE_TEXT` and ignores the text) and set `lastSentAt`.
  - `set_away` on: set `awayStartedAt = now`.
  - Add a `status` tool. Put a `statusText(s, now)` helper in `tools.ts` and use it in both places, removing `away.ts`'s copy.
  - Fix `INSTRUCTIONS` in `away.ts` to describe `minutes`/`at`, not "ISO time".
- [ ] **Step 4: Run** `bun test`. Expect PASS.
- [ ] **Step 5: Commit** with `feat: status tool, secret-safe ask/notify, update tracking`.

### Task 3: Relay, never_relay, outbox, end-of-day, and inbound secret guard

**Files:** Create `plugin/server/relay.ts`. Modify `plugin/server/away.ts` and `plugin/server/index.ts`. Test `test/relay.test.ts`.

**Interfaces:**
- Consumes: State fields (Task 2), `looksLikeSecret` (Task 1).
- Produces:
  - `Deps` gains `neverRelay: string[]` and `endOfDay: "park" | "safest"`.
  - `relay.ts` exports `createRelay(r: RelayDeps)`, returning `{ onPermissionRequest(p: Json): Promise<void>; drainOutbox(): Promise<void>; sweepTimeouts(): Promise<void> }`, where `RelayDeps = { current(): State; update(fn: (s: State) => void): State; say(text: string): Promise<void>; channel(content: string, meta: Record<string,string>): void; now(): number; waitMinutes: number; neverRelay: string[]; endOfDay: "park" | "safest" }`.
  - `pollOnce` order: `sweepTimeouts`, then `drainOutbox`, then fetch and handle messages.

- [ ] **Step 1: Write the failing tests** in `test/relay.test.ts`, building `createAway` with `neverRelay: ["rm -rf", "deploy"]`.
  - `"never_relay requests stay at the terminal"`: a permission request whose `input_preview` contains "rm -rf build" sends "Terminal-only approval" and stores no permission. A "yes <id>" reply then produces no verdict.
  - `"outbox entries are sent on the next poll and cleared"`: write `outbox: [{type:"error", text:"Claude stopped: rate_limit"}]` into state, run `pollOnce`, and expect `fake.sent` to contain "Error\nClaude stopped: rate_limit" and the outbox to be empty.
  - `"an unanswered question parks the task after wait_minutes"`: `ask` at T; `now` advances to T + 61 min; `pollOnce`. Expect a channel event `{kind:"timeout", question_id:"q1"}` whose content contains "park". The question is removed, and Teams gets a note.
  - `"with safest, the timeout says to continue safely"`: `endOfDay: "safest"`, and the content contains "safest".
  - `"a secret-looking reply is never passed to Claude"`: with a question open, a reply of `ghp_` + 36 characters produces no channel event, the question stays open, and Teams says "wasn't passed on".
  - `"a late answer to a timed-out question becomes an instruction"`.
- [ ] **Step 2: Run** `bun test test/relay.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement `relay.ts`.**
  - Move `onNotification`'s body from `away.ts` here and add the `never_relay` check: case-insensitive `includes` over `description + input_preview`.
  - `drainOutbox`: take the outbox in one `update`, then `say` each entry.
  - `sweepTimeouts`: questions with `askedAt <= now - wait` are closed. That needs a new `askedAt: number` on `Question`, set in `ask`; ledger it as a ruling.
- [ ] **Step 4: Inbound guard in `away.ts`.** In `act`, for the `answer` and `instruction` kinds, if `looksLikeSecret(text)`, say the warning and return. Verdicts and commands are untouched.
- [ ] **Step 5: `index.ts`.** Parse `AWAY_NEVER_RELAY` (comma-split, trimmed, empties dropped, default `["rm -rf","git push --force","deploy"]`) and `AWAY_END_OF_DAY_ACTION` (`"safest"` or else `"park"`).
- [ ] **Step 6: Run** `bun test`, then `wc -l plugin/server/*.ts`. Expect PASS, and every file 150 lines or fewer.
- [ ] **Step 7: Commit** with `feat: never_relay, outbox, end-of-day policy, inbound secret guard`.

### Task 4: Hooks

**Files:** Create `plugin/hooks/hooks.json` and `plugin/hooks/hook.ts`, and delete `plugin/hooks/.gitkeep`. Test `test/hook.test.ts`.

**Interfaces:**
- Consumes: the `state.json` fields `awayUntil`, `awayStartedAt`, `lastSentAt`, `lastStopAt`, `outbox`.
- Produces:
  - `hook.ts` exports `decide(input: Record<string, unknown>, state: Record<string, unknown> | null, now: number): { stdout?: string; patch?: Record<string, unknown> }`.
  - When run as the main module (`import.meta.main`), it reads stdin and `$CLAUDE_PLUGIN_DATA/state.json`, prints `stdout`, and merges `patch` into the file atomically (write a tmp file, then rename).

- [ ] **Step 1: Write the failing tests** in `test/hook.test.ts`, one per event, with an away state `{awayUntil: now+1h, awayStartedAt: now-10min, lastSentAt: 0, lastStopAt: 0, outbox: []}`.
  - **Not away or `null` state:** `decide` returns `{}` for every event.
  - **PreToolUse AskUserQuestion:** the deny JSON, with a reason mentioning the `ask` tool.
  - **Stop with nothing sent since `lastStopAt`:** a block, plus a patch of `lastStopAt`.
  - **Stop with `stop_hook_active`:** `{patch: {lastStopAt: now}}` and no block.
  - **Stop where `lastSentAt > lastStopAt`:** no block.
  - **First stop after away began** (`awayStartedAt > lastStopAt` and nothing sent): no block, just the patch.
  - **StopFailure** `{error:"rate_limit", error_details:"429"}`: the patch appends to `outbox`.
  - **UserPromptSubmit "hello":** a patch of `awayUntil: 0`, plus additionalContext containing "back".
  - **UserPromptSubmit starting `<channel source=`:** `{}`.
  - **Timing test:** spawn `bun plugin/hooks/hook.ts` with not-away state and record its duration next to a bare `bun -e 0`. Assert the overhead (hook minus bare Bun) is under 50 ms, and log both numbers.
- [ ] **Step 2: Run** `bun test test/hook.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement `hook.ts`** (under 90 lines, Bun globals only) and `hooks.json`.
  - Four entries: PreToolUse with matcher `AskUserQuestion`, Stop, StopFailure, and UserPromptSubmit.
  - Each runs `"command": "bun", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/hook.ts"]` with `"timeout": 10`.
- [ ] **Step 4: Run** `bun test`, then `bun run validate`. Expect PASS, with the validator listing hooks.
- [ ] **Step 5: Commit** with `feat: hooks redirect questions, ensure finished notes, alert on errors, auto-back`.

### Task 5: Status skill and docs

**Files:** Create `plugin/skills/status/SKILL.md`. Modify `docs/PLAN.md` and `README.md`.

- [ ] **Step 1: Write the status skill.** It triggers on `/away-mode:status`, "am I away?" and "what's waiting?", and calls `status` to report in a few lines.
- [ ] **Step 2: PLAN.md Phase 3.**
  - Tick the hooks, the end-of-day policy, `never_relay`, the sensitive guard and the `status` skill.
  - Under the Check, note the live UserPromptSubmit question.
  - In Risks, add the channel-event and UserPromptSubmit uncertainty and its mitigation.
- [ ] **Step 3: README.**
  - Add `status` to "How to reply".
  - Add a line saying hooks redirect questions automatically while away.
  - Add `never_relay` and `end_of_day_action` behaviour to Configuration.
- [ ] **Step 4: Run** `bun run check`. Expect PASS.
- [ ] **Step 5: Commit** with `docs: Phase 3 hooks, status skill, safety`.
