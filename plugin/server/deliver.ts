// Per-project delivery: acting on a routed action, and which server instance owns delivery.
import type { Kind } from "./adapters/adapter.ts";
import { LEASE_MS } from "./lease.ts";
import type { EndReason } from "./recap.ts";
import { HELD_BACK_TEXT, looksLikeSecret } from "./sensitive.ts";
import { more } from "./more.ts";
import { tagFor } from "./project.ts";
import type { Action } from "./route.ts";
import { isAway, type State } from "./state.ts";
import { clock, MAX_AWAY_MS, resolveUntil } from "./when.ts";
import { withStore } from "./store.ts";
import { statusText } from "./tools.ts";

export interface DeliverEnv {
  dir: string;
  key: string;
  /** This server's instance token. */
  instance: string;
  now(): number;
  /** Default away length; only used by resolveUntil's fallback. */
  hours: number;
  /** Clock time a weekday "until" lands on (vacation_return_time). */
  returnTime: string;
  current(): State;
  update(fn: (s: State) => void): State;
  say(text: string, kind?: Kind, code?: string): Promise<void>;
  notify(method: string, params: Record<string, unknown>): void;
  channel(content: string, meta: Record<string, string>): void;
  answer(id: string, text: string): Promise<void>;
  /** End this project's away mode; returns the recap. */
  end(reason: EndReason): string;
  /** Characters one `say` can carry after the project prefix, before the message cap cuts it. */
  room?: number;
}

/** An away project whose owner hasn't been seen for LEASE_MS is taken over, pending permissions with it. */
export function adopt(dir: string, key: string, instance: string, now: number): void {
  withStore(dir, now, (s) => {
    const p = s.projects[key];
    if (!p || p.awayUntil <= now || p.ownerInstance === instance || now - p.ownerSeen <= LEASE_MS) return;
    p.ownerInstance = instance;
    p.ownerSeen = now;
    for (const perm of p.permissions) perm.instance = instance;
  });
}

/** The owner's queued actions, taken in one write; others get nothing. Refreshes ownerSeen. */
export function drainOwned(dir: string, key: string, instance: string, now: number): Action[] {
  return withStore(dir, now, (s) => {
    const p = s.projects[key];
    if (!p || p.ownerInstance !== instance) return [];
    p.ownerSeen = now;
    const items = p.inbox;
    p.inbox = [];
    return items.map((i) => i.action);
  });
}

const HOUR12 = 12 * 3_600_000;

/**
 * A clock time for `until`, which must still be ahead today: null when it isn't (a wrap to
 * tomorrow would keep away mode on overnight). A bare "6" is read as 6am or 6pm, whichever
 * comes first within 12 hours. NaN when unreadable.
 */
function untilToday(at: string, now: number, hours: number): number | null {
  const first = resolveUntil({ at }, now, hours);
  if (!(first > now)) return first;
  const bare = /^(\d{1,2})(?::\d{2})?$/.exec(at.trim());
  const h = Number(bare?.[1]);
  const options = bare && h >= 1 && h <= 12 ? [first - HOUR12, first, first + HOUR12] : [first];
  const until = Math.min(...options.filter((t) => t > now));
  const today = new Date(until).toDateString() === new Date(now).toDateString();
  return today && (!bare || until - now <= HOUR12) ? until : null;
}

/** `extend 30m` / `until 6pm`: moves this project's end. Not away any more: nothing changes. */
async function extend(e: DeliverEnv, a: Extract<Action, { kind: "extend" }>): Promise<void> {
  const tag = withStore(e.dir, e.now(), (s) => tagFor(e.key, s));
  const now = e.now();
  if (!isAway(e.current(), now)) return e.say(`Away mode already ended for ${tag}.`);
  const until = "minutes" in a ? e.current().awayUntil + a.minutes * 60_000
    : /^[a-z]/i.test(a.at) ? resolveUntil(a, now, e.hours, e.returnTime) : untilToday(a.at, now, e.hours); // a weekday may be any day ahead
  if (until === null) return e.say(`${(a as { at: string }).at} has already passed today. Try extend 30m or until a later time.`);
  if (!(until > now)) return e.say("Couldn't read that time. Try \"extend 30m\" or \"until 6pm\".");
  if (until > now + MAX_AWAY_MS) return e.say("Away mode can last at most 30 days.");
  e.update((s) => void (s.awayUntil = until));
  return e.say(`Away until ${clock(until, now)} for ${tag}.`);
}

/** `snooze 30m` / `snooze until 3pm` / `unsnooze`: finished and info notes wait for the recap. */
async function snooze(e: DeliverEnv, a: Extract<Action, { kind: "snooze" | "unsnooze" }>): Promise<void> {
  const tag = withStore(e.dir, e.now(), (s) => tagFor(e.key, s));
  const now = e.now();
  if (!isAway(e.current(), now)) return e.say(`Away mode already ended for ${tag}.`);
  if (a.kind === "unsnooze") {
    e.update((s) => void (s.snoozeUntil = 0));
    return e.say(`Snooze off for ${tag}.`);
  }
  const until = "minutes" in a ? now + a.minutes * 60_000 : resolveUntil({ at: a.at }, now, e.hours);
  if (!(until > now)) return e.say("Couldn't read that time. Try \"snooze 30m\" or \"snooze until 3pm\".");
  e.update((s) => void (s.snoozeUntil = until));
  return e.say(`Snoozed until ${clock(until, now)} for ${tag}. Questions, approvals and errors still come through.`);
}

export function makeAct(e: DeliverEnv): (a: Action) => Promise<void> {
  function verdict(a: Extract<Action, { kind: "verdict" }>): Promise<void> {
    const perm = e.current().permissions.find((p) => p.id === a.id);
    if (!perm || (perm.instance !== undefined && perm.instance !== e.instance)) return e.say("That request is no longer waiting.");
    if (perm.needsMore && !perm.moreSent) return e.say(`Read it first: more ${a.id}`);
    e.update((s) => void (s.permissions = s.permissions.filter((p) => p.id !== a.id)));
    e.notify("notifications/claude/channel/permission", { request_id: a.id, behavior: a.behavior });
    return e.say(a.behavior === "allow" ? "Approved." : "Denied.");
  }
  return async function act(a: Action): Promise<void> {
    if ((a.kind === "answer" || a.kind === "instruction") && looksLikeSecret(a.text)) return e.say(HELD_BACK_TEXT);
    switch (a.kind) {
      case "drop": return;
      case "confirm": case "prompt": return e.say(a.text);
      case "verdict": return verdict(a);
      case "answer": return e.answer(a.questionId, a.text);
      case "instruction":
        e.channel(a.text, { kind: "instruction" });
        return e.say("Got it, passing that to Claude.");
      case "status": return e.say(statusText(e.current(), e.now()));
      case "extend": return extend(e, a);
      case "more": return more(e, a.id);
      case "snooze": case "unsnooze": return snooze(e, a);
      case "back":
        e.channel("The user ended away mode from Teams.", { kind: "back" });
        return e.say(e.end("back"), "recap");
    }
  };
}
