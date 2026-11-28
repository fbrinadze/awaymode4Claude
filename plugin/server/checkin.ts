// Vacation check-ins: when one is due, and what it says. Pure; sending is the owner server's job.
import { permCutoff } from "./state.ts";
import type { ProjectState } from "./store.ts";
import { withStore } from "./store.ts";
import { clock } from "./when.ts";

export interface CheckinTime {
  h: number;
  m: number;
}

const TIME = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;
const DEFAULT: CheckinTime[] = [{ h: 9, m: 0 }];

function parseOne(s: string): CheckinTime | null {
  const m = TIME.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ampm = m[3]?.toLowerCase();
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === "pm" ? 12 : 0);
  }
  return h > 23 || min > 59 ? null : { h, m: min };
}

/** "9:00, 18:00": invalid entries dropped, sorted; nothing valid means 9:00. */
export function parseCheckins(s: string | undefined): CheckinTime[] {
  const ok = (s ?? "").split(",").map(parseOne).filter((t): t is CheckinTime => t !== null);
  return ok.length ? ok.sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m)) : DEFAULT;
}

/** The latest scheduled local time t with lastAt < t <= now (looking back 2 days), or null. One value however many passed. */
export function dueCheckin(times: CheckinTime[], lastAt: number, now: number): number | null {
  let best: number | null = null;
  for (let back = 2; back >= 0; back--) {
    for (const { h, m } of times) {
      const d = new Date(now);
      d.setDate(d.getDate() - back);
      d.setHours(h, m, 0, 0);
      const t = d.getTime();
      if (t > lastAt && t <= now && (best === null || t > best)) best = t;
    }
  }
  return best;
}

const waited = (at: number, now: number) => `${Math.max(0, Math.floor((now - at) / 3_600_000))}h`;

export function checkinText(p: ProjectState, now: number): string {
  const finished = p.vacation?.finished ?? 0;
  const parked = p.recap.filter((r) => r.kind === "parked").map((r) => `- ${r.text}`);
  const waiting = [
    ...p.permissions.map((x) => `- ${x.tool} ${x.id} (waiting ${waited(x.at, now)}): reply yes ${x.id} or no ${x.id}`),
    ...p.questions.map((q) => `- ${q.id}: ${q.text} (waiting ${waited(q.askedAt ?? now, now)})`),
  ];
  const head = `On vacation until ${clock(p.awayUntil, now)}`;
  if (!waiting.length && !parked.length && finished <= 0) return `${head}\nStill working. Nothing needs you.`;
  return [
    head,
    ...(finished > 0 ? [`${finished} finished since the last check-in (sent as they happened)`] : []),
    ...(waiting.length ? ["Waiting for you:", ...waiting] : []),
    ...(parked.length ? ["Parked:", ...parked, "Reply with what to do and it goes to Claude."] : []),
  ].join("\n");
}

export interface CheckinCtx {
  dir: string;
  key: string;
  instance: string;
  times: CheckinTime[];
  waitMinutes: number;
  now(): number;
}

/** Owner only, on vacation, when a check-in is due: marks it taken (one catch-up however many were missed) and returns its text and the marks it replaced. */
function takeCheckin(c: CheckinCtx, now: number): { text: string; prev: { at: number; finished: number } } | null {
  return withStore(c.dir, now, (s) => {
    const p = s.projects[c.key];
    if (!p?.vacation || p.ownerInstance !== c.instance || p.awayUntil <= now) return null;
    if (dueCheckin(c.times, p.vacation.lastCheckinAt, now) === null) return null;
    const cutoff = permCutoff(now, c.waitMinutes); // expired approvals can't be answered any more
    const text = checkinText({ ...p, permissions: p.permissions.filter((x) => x.at > cutoff) }, now);
    const prev = { at: p.vacation.lastCheckinAt, finished: p.vacation.finished };
    p.vacation.lastCheckinAt = now;
    p.vacation.finished = 0;
    return { text, prev };
  });
}

/**
 * Take the due check-in (if any) and start sending it; null when none is due (so the caller adds no await).
 * If the send fails the check-in is handed back, so the next tick retries it.
 */
export function sendCheckin(c: CheckinCtx, send: (text: string) => Promise<unknown>): Promise<void> | null {
  const taken = takeCheckin(c, c.now());
  if (!taken) return null;
  return send(taken.text).then(() => undefined, (e: unknown) => {
    withStore(c.dir, c.now(), (s) => {
      const v = s.projects[c.key]?.vacation;
      if (v) { v.lastCheckinAt = taken.prev.at; v.finished += taken.prev.finished; }
    });
    throw e;
  });
}
