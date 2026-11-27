// Away Mode hooks: PostToolUse (set_away), PreToolUse (AskUserQuestion), Stop, StopFailure, UserPromptSubmit.
// No project imports: this runs on every hook event and must start fast. When no project is
// away it exits without even reading stdin.
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Obj = Record<string, unknown>;
export interface Decision {
  stdout?: string;
  patch?: Obj;
  /** Patch keys whose arrays are appended to the entry's current array instead of replacing it. */
  append?: string[];
}

const ASK_INSTEAD =
  "The user is away from the terminal (Away Mode is on). Ask with the Away Mode `ask` tool instead; it reaches them in Teams.";
const NOTE_FIRST =
  "Away Mode: the user is away. Before stopping, send a short notify (type finished: two or three lines on what you did; or type error if you're stuck). Then you can stop.";
const WELCOME_BACK =
  "The user is back at the terminal, so Away Mode is now off. Briefly list anything they missed while away: questions asked in Teams that are still open, approvals, and tasks you finished or parked.";

/** This plugin's own tool. Another server's set_away must not move ownership. */
const SET_AWAY = "mcp__plugin_away-mode_away__set_away";

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const isAway = (s: Obj | null | undefined, now: number): s is Obj => !!s && num(s.awayUntil) > now;

/** Same normalisation as the server's projectKey: absolute path, lower-cased on Windows. */
export function projectKeyOf(input: Obj): string {
  const dir = resolve(process.env.CLAUDE_PROJECT_DIR || String(input.cwd ?? "."));
  return process.platform === "win32" ? dir.toLowerCase() : dir;
}

/** What to print and how to change one project's entry in state.json. Pure, for tests. */
export function decide(input: Obj, project: Obj | null, now: number): Decision {
  if (!isAway(project, now)) return {};
  if (input.hook_event_name === "PostToolUse") {
    // Our set_away just turned away mode on: this session owns it.
    const on = (input.tool_input as Obj | undefined)?.on === true;
    const failed = (input.tool_response as Obj | undefined)?.isError === true;
    const ours = input.tool_name === SET_AWAY && !failed;
    return ours && on && typeof input.session_id === "string" ? { patch: { sessionId: input.session_id } } : {};
  }
  // Several sessions can share a project; act only for the one that's away.
  if (typeof project.sessionId === "string" && input.session_id !== project.sessionId) return {};
  switch (input.hook_event_name) {
    case "PreToolUse":
      if (input.tool_name !== "AskUserQuestion") return {};
      return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ASK_INSTEAD } }) };
    case "Stop": {
      const quiet = num(project.lastSentAt) <= num(project.lastStopAt);
      const awayBeganThisTurn = num(project.awayStartedAt) > num(project.lastStopAt);
      if (input.stop_hook_active || !quiet || awayBeganThisTurn) return { patch: { lastStopAt: now } };
      return { stdout: JSON.stringify({ decision: "block", reason: NOTE_FIRST }) };
    }
    case "StopFailure": {
      const details = input.error_details ? ` (${input.error_details})` : "";
      // Appended to the outbox as re-read under the lock (see apply), not to this unlocked copy.
      return { patch: { outbox: [{ type: "error", text: `Claude stopped: ${input.error ?? "unknown error"}${details}` }] }, append: ["outbox"] };
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

function read(file: string): Obj | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Obj;
  } catch {
    return null;
  }
}
const projectsOf = (s: Obj | null): Record<string, Obj> => (s?.projects ?? {}) as Record<string, Obj>;

/** The lock file holds its owner's pid. True when that process is gone (EPERM means alive). */
function holderDead(path: string): boolean {
  const pid = Number.parseInt(readFileSync(path, "utf8"), 10);
  if (!(pid > 0)) return false; // Empty or unreadable: fall back to the age rule.
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** Same protocol as the server's store lock: wx create with our pid, stale after 5 s or a dead holder, retry every 50 ms for 2 s. */
function lock(path: string): boolean {
  // A real deadline, not a count of sleeps: on a loaded machine each sleep overshoots and 41 of them ran past 5 s in CI.
  for (const give = Date.now() + 2000; Date.now() <= give; ) {
    try {
      writeFileSync(path, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      try {
        if (holderDead(path) || Date.now() - statSync(path).mtimeMs > 5000) unlinkSync(path);
      } catch {
        // Lock vanished between the two calls: just retry.
      }
      Bun.sleepSync(50);
    }
  }
  return false;
}

/** Merge a patch into one project's entry under the lock; a missing entry is left alone. */
function apply(dir: string, key: string, patch: Obj, append: string[] = []): boolean {
  const file = `${dir}/state.json`;
  const path = `${dir}/state.lock`;
  if (!lock(path)) return false; // Can't get the lock: skip rather than race the server.
  try {
    const latest = read(file);
    const entry = projectsOf(latest)[key];
    if (!latest || !entry) return false;
    const merged = { ...entry, ...patch };
    for (const k of append) merged[k] = [...(Array.isArray(entry[k]) ? (entry[k] as unknown[]) : []), ...(patch[k] as unknown[])];
    const next = { ...latest, projects: { ...projectsOf(latest), [key]: merged } };
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
    return true;
  } finally {
    unlinkSync(path);
  }
}

if (import.meta.main) {
  const dir = process.env.CLAUDE_PLUGIN_DATA ?? "";
  const state = dir ? read(`${dir}/state.json`) : null;
  const now = Date.now();
  if (Object.values(projectsOf(state)).some((p) => isAway(p, now))) {
    let input: Obj = {};
    try {
      input = JSON.parse((await Bun.stdin.text()).replace(/^﻿/, "") || "{}") as Obj;
    } catch {
      // Unreadable hook input: do nothing rather than fail the user's tool call.
    }
    const key = projectKeyOf(input);
    const d = decide(input, projectsOf(state)[key] ?? null, now);
    // A skipped write (lock busy) means away mode is still on: don't announce "welcome back".
    const wrote = d.patch ? apply(dir, key, d.patch, d.append) : true;
    if (d.stdout && wrote) await Bun.write(Bun.stdout, d.stdout);
  }
}
