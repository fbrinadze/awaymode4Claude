import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide } from "../plugin/hooks/hook.ts";

const now = Date.parse("2026-11-26T18:00:00Z");
const away = () => ({ awayUntil: now + 3_600_000, awayStartedAt: now - 600_000, lastSentAt: 0, lastStopAt: 0, outbox: [] });
const ask = { hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: {} };
const stop = (extra = {}) => ({ hook_event_name: "Stop", stop_hook_active: false, ...extra });

test("nothing happens when away mode is off or there's no state", () => {
  const off = { ...away(), awayUntil: 0 };
  for (const input of [ask, stop(), { hook_event_name: "StopFailure", error: "rate_limit" }, { hook_event_name: "UserPromptSubmit", prompt: "hi" }]) {
    expect(decide(input, off, now)).toEqual({});
    expect(decide(input, null, now)).toEqual({});
  }
});

test("AskUserQuestion is denied with a pointer to the ask tool", () => {
  const out = JSON.parse(decide(ask, away(), now).stdout!);
  expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(out.hookSpecificOutput.permissionDecisionReason).toContain("ask");
});

test("Stop is blocked once when Claude sent nothing since the last stop", () => {
  const s = { ...away(), lastStopAt: now - 300_000 }; // away began before the last stop
  const r = decide(stop(), s, now);
  expect(JSON.parse(r.stdout!)).toMatchObject({ decision: "block" });
  expect(JSON.parse(r.stdout!).reason).toContain("notify");
});

test("Stop is never blocked twice in a row", () => {
  const s = { ...away(), lastStopAt: now - 300_000 };
  expect(decide(stop({ stop_hook_active: true }), s, now)).toEqual({ patch: { lastStopAt: now } });
});

test("Stop goes through when Claude already reached the user", () => {
  const s = { ...away(), lastStopAt: now - 300_000, lastSentAt: now - 60_000 };
  expect(decide(stop(), s, now)).toEqual({ patch: { lastStopAt: now } });
});

test("the turn that turned away mode on can end without a note", () => {
  const s = { ...away(), lastStopAt: now - 900_000 }; // away began after the last stop
  expect(decide(stop(), s, now)).toEqual({ patch: { lastStopAt: now } });
});

test("StopFailure queues an error for Teams", () => {
  const r = decide({ hook_event_name: "StopFailure", error: "rate_limit", error_details: "429 Too Many Requests" }, away(), now);
  expect(r.patch).toEqual({ outbox: [{ type: "error", text: "Claude stopped: rate_limit (429 Too Many Requests)" }] });
});

test("typing at the terminal ends away mode", () => {
  const r = decide({ hook_event_name: "UserPromptSubmit", prompt: "ok I'm back, what happened?" }, away(), now);
  expect(r.patch).toEqual({ awayUntil: 0 });
  expect(JSON.parse(r.stdout!).hookSpecificOutput.additionalContext).toContain("back");
});

test("a Teams message arriving as a channel event does not end away mode", () => {
  const prompt = '<channel source="plugin:away-mode:away" kind="answer" question_id="q1">2</channel>';
  expect(decide({ hook_event_name: "UserPromptSubmit", prompt }, away(), now)).toEqual({});
});

test("the session that turned away mode on is recorded as its owner", () => {
  const r = decide(
    { hook_event_name: "PostToolUse", session_id: "A", tool_name: "mcp__plugin_away-mode_away__set_away", tool_input: { on: true } },
    away(),
    now,
  );
  expect(r).toEqual({ patch: { awaySession: "A" } });
});

test("only this plugin's own set_away can claim ownership", () => {
  const owned = { ...away(), awaySession: "A" };
  const post = (tool_name: string) => ({ hook_event_name: "PostToolUse", session_id: "B", tool_name, tool_input: { on: true } });
  expect(decide(post("mcp__other__set_away"), owned, now)).toEqual({});
  expect(decide(post("mcp__plugin_evil_away__set_away"), owned, now)).toEqual({});
  expect(decide({ ...post("mcp__plugin_away-mode_away__set_away"), tool_response: { isError: true } }, owned, now)).toEqual({});
});

test("other sessions are left alone while one is away", () => {
  const owned = { ...away(), awaySession: "A", lastStopAt: now - 300_000 };
  expect(decide({ ...ask, session_id: "B" }, owned, now)).toEqual({});
  expect(decide({ ...stop(), session_id: "B" }, owned, now)).toEqual({});
  expect(decide({ hook_event_name: "UserPromptSubmit", session_id: "B", prompt: "hi" }, owned, now)).toEqual({});
  expect(decide({ hook_event_name: "StopFailure", session_id: "B", error: "rate_limit" }, owned, now)).toEqual({});
  // The owner still gets the behaviour.
  expect(decide({ ...ask, session_id: "A" }, owned, now).stdout).toContain("deny");
  expect(decide({ hook_event_name: "UserPromptSubmit", session_id: "A", prompt: "hi" }, owned, now).patch).toEqual({ awayUntil: 0 });
});

test("the hook script adds little to Bun's own startup when away mode is off", async () => {
  const dir = mkdtempSync(join(tmpdir(), "away-hook-"));
  writeFileSync(join(dir, "state.json"), JSON.stringify({ awayUntil: 0 }));
  const run = async (args: string[]) => {
    const start = performance.now();
    const p = Bun.spawn(["bun", ...args], { env: { ...process.env, CLAUDE_PLUGIN_DATA: dir }, stdin: new Blob([JSON.stringify(ask)]), stdout: "pipe" });
    await p.exited;
    return { ms: performance.now() - start, out: await new Response(p.stdout).text() };
  };
  await run(["-e", "0"]); // warm the cache
  const bare = Math.min(...(await Promise.all([1, 2, 3].map(() => run(["-e", "0"])))).map((r) => r.ms));
  const hookRuns = await Promise.all([1, 2, 3].map(() => run(["plugin/hooks/hook.ts"])));
  const hook = Math.min(...hookRuns.map((r) => r.ms));
  console.log(`bun startup ${bare.toFixed(0)} ms, hook (away off) ${hook.toFixed(0)} ms, overhead ${(hook - bare).toFixed(0)} ms`);
  expect(hookRuns[0]!.out).toBe("");
  expect(hook - bare).toBeLessThan(50);
});
