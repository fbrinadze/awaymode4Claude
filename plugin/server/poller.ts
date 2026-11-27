// The single Graph poller: whoever holds the lease fetches, dispatches and fills inboxes.
import type { Adapter, Msg } from "./adapters/adapter.ts";
import { dispatch, type Routed } from "./dispatch.ts";
import { releaseLease, takeLease } from "./lease.ts";
import { tagFor } from "./project.ts";
import { endAway } from "./recap.ts";
import type { Action } from "./route.ts";
import { type Store, withStore } from "./store.ts";

export interface PollerDeps {
  dir: string;
  key: string;
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

/** The cursor to poll from if this project is away and holds the lease, else null. */
function claim(d: PollerDeps): string | null {
  const t = d.now();
  return withStore(d.dir, t, (s) => {
    if (!((s.projects[d.key]?.awayUntil ?? 0) > t)) return releaseLease(s, d.key), null;
    return takeLease(s, d.key, t) ? s.cursor : null;
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

/** Cursor moves with the dispatch, in one write: a message is acted on at most once. */
function routeOne(d: PollerDeps, m: Msg): Routed {
  const t = d.now();
  return withStore(d.dir, t, (s) => {
    s.cursor = m.at;
    const r = dispatch(m, live(s, d, t), t, d.replyRouting ?? false);
    for (const k of r.targets) if (k !== d.key) s.projects[k]?.inbox.push({ action: r.action, at: m.at });
    return r;
  });
}

/** Projects whose time ran out are ended under the lock, so exactly one server sends each recap. */
export async function sweepExpired(d: PollerDeps): Promise<void> {
  const t = d.now();
  const recaps = withStore(d.dir, t, (s) =>
    Object.entries(s.projects)
      .filter(([, p]) => p.awayUntil > 0 && p.awayUntil <= t)
      .map(([k, p]) => ({ tag: tagFor(k, s), text: endAway(p, "expired") })));
  for (const r of recaps) await d.announce(r.tag, r.text);
}

/** One poll cycle; returns how many messages arrived (0 when not the holder). Graph I/O stays outside the lock. */
export async function pollCycle(d: PollerDeps): Promise<number> {
  await sweepExpired(d);
  const cursor = claim(d);
  if (cursor === null) return 0;
  const msgs = await d.adapter.poll(cursor);
  for (const m of msgs) {
    const r = routeOne(d, m);
    // No target (drop, prompt): the holder answers, since nobody else will.
    if (!r.targets.length || r.targets.includes(d.key)) await d.deliverLocal(r);
  }
  return msgs.length;
}
