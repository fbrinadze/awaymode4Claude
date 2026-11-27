// The single Graph poller: whoever holds the lease fetches, dispatches and fills inboxes.
import type { Adapter, Msg } from "./adapters/adapter.ts";
import { dispatch, type Routed } from "./dispatch.ts";
import { LEASE_MS, releaseLease, takeLease } from "./lease.ts";
import { tagFor } from "./project.ts";
import { endAway } from "./recap.ts";
import type { Action } from "./route.ts";
import { HELD_BACK_TEXT, looksLikeSecret } from "./sensitive.ts";
import { type ProjectState, type Store, withStore } from "./store.ts";

export interface PollerDeps {
  dir: string;
  key: string;
  /** This server's instance token: the lease and delivery belong to it, not to the project. */
  instance: string;
  now(): number;
  adapter: Adapter;
  deliverLocal(r: Routed): Promise<void>;
  /** Post a message labelled with a project's tag. */
  announce(tag: string, text: string): Promise<void>;
  /** Route replies to a quoted project message (Task 14 wires the setting). */
  replyRouting?: boolean;
  /** Permissions older than this many minutes no longer route as verdicts. */
  waitMinutes?: number;
}

/** A copy of the store without permissions past the wait_minutes cutoff, for dispatch only. */
function live(s: Store, d: PollerDeps, now: number): Store {
  if (d.waitMinutes === undefined) return s;
  const cutoff = now - d.waitMinutes * 60_000;
  const projects = Object.fromEntries(Object.entries(s.projects).map(([k, p]) =>
    [k, { ...p, permissions: p.permissions.filter((x) => x.at > cutoff) }]));
  return { ...s, projects };
}

/** The cursor to poll from if this instance owns an away project and holds the lease, else null. */
function claim(d: PollerDeps): string | null {
  const t = d.now();
  return withStore(d.dir, t, (s) => {
    const p = s.projects[d.key];
    if (!p || !(p.awayUntil > t) || p.ownerInstance !== d.instance) return releaseLease(s, d.instance), null;
    // A lease whose holder no longer owns any away project (ownership moved) is dead: don't wait it out.
    const h = s.lease?.owner;
    if (h && !Object.values(s.projects).some((q) => q.awayUntil > t && q.ownerInstance === h)) s.lease = null;
    return takeLease(s, d.instance, t) ? s.cursor : null;
  });
}

/** Take this project's queued actions (put there by the poller in another server). */
export function drainInbox(dir: string, key: string, now: number): Action[] {
  return withStore(dir, now, (s) => {
    const p = s.projects[key];
    const items = p?.inbox ?? [];
    if (p) p.inbox = [];
    return items.map((i) => i.action);
  });
}

/** A pasted secret is replaced before anything is stored or delivered (another project's inbox is on disk). */
function held(r: Routed): Routed {
  const a = r.action;
  const secret = (a.kind === "answer" || a.kind === "instruction") && looksLikeSecret(a.text);
  return secret ? { ...r, action: { kind: "prompt", text: HELD_BACK_TEXT } } : r;
}

/**
 * Cursor moves with the dispatch, in one write: a message is acted on at most once, and a
 * message at or before the cursor is skipped. Returns null for those; `local` is true when
 * this instance owns a target (or none is named) and delivers it itself. Others get an inbox item.
 */
function routeOne(d: PollerDeps, m: Msg): { r: Routed; local: boolean } | null {
  const t = d.now();
  return withStore(d.dir, t, (s) => {
    if (m.at <= s.cursor) return null;
    s.cursor = m.at;
    const r = held(dispatch(m, live(s, d, t), t, d.replyRouting ?? false));
    const mine = (k: string) => k === d.key && s.projects[k]?.ownerInstance === d.instance;
    for (const k of r.targets) if (!mine(k)) s.projects[k]?.inbox.push({ action: r.action, at: m.at });
    return { r, local: !r.targets.length || r.targets.some(mine) };
  });
}

/** The recap a sweep sends for this project, if any: its time ran out, or its owner died after away ended. */
function sweepOne(p: ProjectState, t: number): string | null {
  if (p.awayUntil > 0 && p.awayUntil <= t) return endAway(p, "expired");
  if (p.awayUntil !== 0 || !p.ownerInstance || t - p.ownerSeen <= LEASE_MS) return null;
  if (!p.ended) return endAway(p, "terminal"); // the hook ended it; the owner never sent the recap
  Object.assign(p, { ownerInstance: undefined, ended: undefined }); // recap already out; nobody left to tell
  return null;
}

/** Ended under the lock, so exactly one server sends each recap. */
export async function sweepExpired(d: PollerDeps): Promise<void> {
  const t = d.now();
  const recaps = withStore(d.dir, t, (s) =>
    Object.entries(s.projects).flatMap(([k, p]) => {
      const text = sweepOne(p, t);
      return text === null ? [] : [{ tag: tagFor(k, s), text }];
    }));
  for (const r of recaps) await d.announce(r.tag, r.text);
}

/** One poll cycle; returns how many messages arrived (0 when not the holder). Graph I/O stays outside the lock. */
export async function pollCycle(d: PollerDeps): Promise<number> {
  await sweepExpired(d);
  const cursor = claim(d);
  if (cursor === null) return 0;
  const msgs = await d.adapter.poll(cursor);
  for (const m of msgs) {
    const o = routeOne(d, m);
    // No target (drop, prompt): the holder answers, since nobody else will.
    if (o?.local) await d.deliverLocal(o.r);
  }
  return msgs.length;
}
