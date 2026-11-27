// Away Mode hooks: PostToolUse (set_away), PreToolUse (AskUserQuestion), Stop, StopFailure, UserPromptSubmit.
// No project imports: this runs on every hook event and must start fast. When away mode is
// off it exits without even reading stdin.
import { renameSync } from "node:fs";

type Obj = Record<string, unknown>;
export interface Decision {
  stdout?: string;
  patch?: Obj;
}

const ASK_INSTEAD =
  "The user is away from the terminal (Away Mode is on). Ask with the Away Mode `ask` tool instead; it reaches them in Teams.";
const NOTE_FIRST =
  "Away Mode: the user is away. Before stopping, send a short notify (type finished: two or three lines on what you did; or type error if you're stuck). Then you can stop.";
const WELCOME_BACK =
  "The user is back at the terminal, so Away Mode is now off. Briefly list anything they missed while away: questions asked in Teams that are still open, approvals, and tasks you finished or parked.";

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const isAway = (s: Obj | null, now: number): s is Obj => !!s && num(s.awayUntil) > now;

/** What to print and how to change state.json for one hook event. Pure, for tests. */
export function decide(input: Obj, state: Obj | null, now: number): Decision {
  if (!isAway(state, now)) return {};
  if (input.hook_event_name === "PostToolUse") {
    // set_away just turned away mode on: this session owns it.
    const on = (input.tool_input as Obj | undefined)?.on === true;
    return on && typeof input.session_id === "string" ? { patch: { awaySession: input.session_id } } : {};
  }
  // Away state is shared by every session on the machine; act only for the one that's away.
  if (typeof state.awaySession === "string" && input.session_id !== state.awaySession) return {};
  switch (input.hook_event_name) {
    case "PreToolUse":
      if (input.tool_name !== "AskUserQuestion") return {};
      return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ASK_INSTEAD } }) };
    case "Stop": {
      const quiet = num(state.lastSentAt) <= num(state.lastStopAt);
      const awayBeganThisTurn = num(state.awayStartedAt) > num(state.lastStopAt);
      if (input.stop_hook_active || !quiet || awayBeganThisTurn) return { patch: { lastStopAt: now } };
      return { stdout: JSON.stringify({ decision: "block", reason: NOTE_FIRST }) };
    }
    case "StopFailure": {
      const details = input.error_details ? ` (${input.error_details})` : "";
      const outbox = Array.isArray(state.outbox) ? state.outbox : [];
      return { patch: { outbox: [...outbox, { type: "error", text: `Claude stopped: ${input.error ?? "unknown error"}${details}` }] } };
    }
    case "UserPromptSubmit":
      // Teams replies arrive as <channel> events; only the user typing here means they're back.
      if (String(input.prompt ?? "").trimStart().startsWith("<channel")) return {};
      return {
        patch: { awayUntil: 0 },
        stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: WELCOME_BACK } }),
      };
  }
  return {};
}

async function readState(file: string): Promise<Obj | null> {
  try {
    return (await Bun.file(file).json()) as Obj;
  } catch {
    return null;
  }
}

if (import.meta.main) {
  const file = `${process.env.CLAUDE_PLUGIN_DATA ?? ""}/state.json`;
  const state = process.env.CLAUDE_PLUGIN_DATA ? await readState(file) : null;
  if (isAway(state, Date.now())) {
    const input = JSON.parse((await Bun.stdin.text()).replace(/^﻿/, "") || "{}") as Obj;
    const d = decide(input, state, Date.now());
    if (d.patch) {
      // ponytail: re-read just before writing to keep the race with the server to milliseconds;
      // a lock file would close it fully if it ever matters.
      const latest = (await readState(file)) ?? state;
      const tmp = `${file}.${process.pid}.tmp`;
      await Bun.write(tmp, JSON.stringify({ ...latest, ...d.patch }, null, 2));
      renameSync(tmp, file);
    }
    if (d.stdout) await Bun.write(Bun.stdout, d.stdout);
  }
}
