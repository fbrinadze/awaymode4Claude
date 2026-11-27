// The Teams command grammar (spec 6.1-6.3): exact matches only, anything else is plain text.
import type { Action } from "./route.ts";

const DUR = String.raw`(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?)`;
const CLOCK = String.raw`(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)`;
const EXTEND = new RegExp(`^extend\\s+${DUR}$`);
const UNTIL = new RegExp(`^until\\s+${CLOCK}$`);
const SNOOZE = new RegExp(`^snooze\\s+${DUR}$`);
const SNOOZE_UNTIL = new RegExp(`^snooze\\s+until\\s+${CLOCK}$`);
const MORE = /^more\s+([a-km-z]{5})$/;

const minutes = (n: string, unit: string) => Number(n) * (unit.startsWith("h") ? 60 : 1);

/** `status`, `back`, `extend`, `until`, `snooze`, `unsnooze`, `more <id>`; null for everything else. */
export function parseCommand(text: string): Action | null {
  const t = text.trim().toLowerCase();
  if (t === "status" || t === "back" || t === "unsnooze") return { kind: t };
  let m = EXTEND.exec(t);
  if (m) return { kind: "extend", minutes: minutes(m[1]!, m[2]!) };
  m = UNTIL.exec(t);
  if (m) return { kind: "extend", at: m[1]! };
  m = SNOOZE.exec(t);
  if (m) return { kind: "snooze", minutes: minutes(m[1]!, m[2]!) };
  m = SNOOZE_UNTIL.exec(t);
  if (m) return { kind: "snooze", at: m[1]! };
  m = MORE.exec(t);
  return m ? { kind: "more", id: m[1]! } : null;
}
