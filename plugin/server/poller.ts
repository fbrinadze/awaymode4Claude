// The single Graph poller: whoever holds the lease fetches, dispatches and fills inboxes.
import type { Adapter, Msg } from "./adapters/adapter.ts";
import { dispatch, type Routed } from "./dispatch.ts";
import { releaseLease, takeLease } from "./lease.ts";
import type { Action } from "./route.ts";
import { withStore } from "./store.ts";

export interface PollerDeps {
  dir: string;
  key: string;
  now(): number;
  adapter: Adapter;
  deliverLocal(r: Routed): Promise<void>;
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
    const r = dispatch(m, s, t);
    for (const k of r.targets) if (k !== d.key) s.projects[k]?.inbox.push({ action: r.action, at: m.at });
    return r;
  });
}

/** One poll cycle; returns how many messages arrived (0 when not the holder). Graph I/O stays outside the lock. */
export async function pollCycle(d: PollerDeps): Promise<number> {
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
