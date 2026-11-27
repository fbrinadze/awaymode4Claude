// Per-project delivery: acting on a routed action, and which server instance owns delivery.
import { LEASE_MS } from "./lease.ts";
import { HELD_BACK_TEXT, looksLikeSecret } from "./sensitive.ts";
import type { Action } from "./route.ts";
import type { State } from "./state.ts";
import { withStore } from "./store.ts";
import { statusText } from "./tools.ts";

export interface DeliverEnv {
  dir: string;
  key: string;
  /** This server's instance token. */
  instance: string;
  now(): number;
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

export function makeAct(e: DeliverEnv): (a: Action) => Promise<void> {
  function verdict(a: Extract<Action, { kind: "verdict" }>): Promise<void> {
    const owner = e.current().permissions.find((p) => p.id === a.id)?.instance;
    if (owner !== undefined && owner !== e.instance) return e.say("That request is no longer waiting.");
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
      case "extend": case "snooze": case "unsnooze": case "more": return e.say("Coming soon."); // delivery lands in a later task
      case "back":
        e.update((s) => void (s.awayUntil = 0));
        e.channel("The user ended away mode from Teams.", { kind: "back" });
        return e.say("Away mode off. Welcome back.");
    }
  };
}
