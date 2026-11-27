// Per-project delivery: acting on a routed action, and which server instance owns delivery.
import { LEASE_MS } from "./lease.ts";
import { HELD_BACK_TEXT, looksLikeSecret } from "./sensitive.ts";
import { more } from "./more.ts";
import { tagFor } from "./project.ts";
import type { Action } from "./route.ts";
import { isAway, type State } from "./state.ts";
import { resolveUntil } from "./when.ts";
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
  current(): State;
  update(fn: (s: State) => void): State;
  say(text: string): Promise<void>;
  notify(method: string, params: Record<string, unknown>): void;
  channel(content: string, meta: Record<string, string>): void;
  answer(id: string, text: string): Promise<void>;
}

/** set_away on: this server now owns delivery for its project. */
export function claimOwner(dir: string, key: string, instance: string, now: number): void {
  withStore(dir, now, (s) => {
    const p = s.projects[key];
    if (p) Object.assign(p, { ownerInstance: instance, ownerSeen: now });
  });
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

/** `extend 30m` / `until 6pm`: moves this project's end. Not away any more: nothing changes. */
async function extend(e: DeliverEnv, a: Extract<Action, { kind: "extend" }>): Promise<void> {
  const tag = withStore(e.dir, e.now(), (s) => tagFor(e.key, s));
  const now = e.now();
  if (!isAway(e.current(), now)) return e.say(`Away mode already ended for ${tag}.`);
  const until = "minutes" in a ? e.current().awayUntil + a.minutes * 60_000 : resolveUntil({ at: a.at }, now, e.hours);
  if (!(until > now)) return e.say("Couldn't read that time. Try \"extend 30m\" or \"until 6pm\".");
  e.update((s) => void (s.awayUntil = until));
  return e.say(`Away until ${new Date(until).toString()} for ${tag}.`);
}

export function makeAct(e: DeliverEnv): (a: Action) => Promise<void> {
  function verdict(a: Extract<Action, { kind: "verdict" }>): Promise<void> {
    const perm = e.current().permissions.find((p) => p.id === a.id);
    if (perm?.instance !== undefined && perm.instance !== e.instance) return e.say("That request is no longer waiting.");
    if (perm?.needsMore && !perm.moreSent) return e.say(`Read it first: more ${a.id}`);
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
      case "snooze": case "unsnooze": return e.say("Coming soon."); // delivery lands in a later task
      case "back":
        e.update((s) => void (s.awayUntil = 0));
        e.channel("The user ended away mode from Teams.", { kind: "back" });
        return e.say("Away mode off. Welcome back.");
    }
  };
}
