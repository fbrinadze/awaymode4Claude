import type { Json } from "./mcp.ts";

const CLOCK = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;

/**
 * End time in epoch ms, from the server's own clock and timezone. Claude knows the date but not
 * the time, so "for 30 minutes" and "back at 1:30" are resolved here. NaN means unusable.
 */
export function resolveUntil(a: Json, now: number, hours: number): number {
  if (typeof a.minutes === "number") return a.minutes > 0 ? now + a.minutes * 60_000 : NaN;
  if (typeof a.at === "string") {
    const m = CLOCK.exec(a.at.trim());
    if (!m) return NaN;
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const ampm = m[3]?.toLowerCase();
    if (ampm) h = (h % 12) + (ampm === "pm" ? 12 : 0);
    if (h > 23 || min > 59) return NaN;
    const d = new Date(now);
    d.setHours(h, min, 0, 0);
    // The next time the clock shows it: "back at 1:30" said at 2 PM means tomorrow.
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  if (a.until !== undefined) return Date.parse(String(a.until));
  return now + hours * 3_600_000;
}

/** A time people read at a glance: "6:30 PM" today, "Sat 9:00 AM" another day (en-US, local time). */
export function clock(ms: number, now: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
}
