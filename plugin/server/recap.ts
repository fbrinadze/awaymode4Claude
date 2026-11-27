// Clean away start and end (spec 5.6 R2/R3, 6.4): one place that resets a project's away state.
import { tagFor } from "./project.ts";
import { freshProject, type ProjectState, readStore, type RecapItem, type Store, withStore } from "./store.ts";

export type EndReason = "expired" | "back" | "terminal" | "off" | "handover";

const bullets = (title: string, lines: string[]): string[] => (lines.length ? [`${title}:`, ...lines.map((l) => `- ${l}`)] : []);
const texts = (p: ProjectState, ...kinds: RecapItem["kind"][]) => p.recap.filter((r) => kinds.includes(r.kind)).map((r) => r.text);

/**
 * The recap text, then the project is left clean: nothing pending, no session, not away. After an
 * expiry or handover the owner is kept (marked `ended`) so it can tell its own Claude; otherwise cleared.
 */
export function endAway(p: ProjectState, reason: EndReason): string {
  const text = [
    reason === "terminal" ? "You're back at the terminal." : `Away ended (${reason}).`,
    ...bullets("Finished", texts(p, "finished", "info")),
    ...bullets("Still waiting (cancelled)", p.permissions.map((x) => `${x.tool} ${x.id}`)),
    ...bullets("Unanswered", p.questions.map((q) => `${q.id}: ${q.text}`)),
    ...bullets("Parked", texts(p, "parked")),
  ].join("\n");
  const tell = (reason === "expired" || reason === "handover") && !!p.ownerInstance;
  Object.assign(p, { permissions: [], questions: [], inbox: [], recap: [], sessionId: undefined, awayUntil: 0, snoozeUntil: 0 });
  Object.assign(p, tell ? { ended: reason } : { ownerInstance: undefined, ended: undefined });
  return text;
}

/** A new away period: earlier replies and pending items aren't for it. The cursor moves only if no other project is away. */
export function startAway(s: Store, key: string, until: number, now: number, instance: string): void {
  const p = s.projects[key];
  if (!p) throw new Error(`No project ${key}.`);
  const othersAway = Object.entries(s.projects).some(([k, o]) => k !== key && o.awayUntil > now);
  if (!othersAway) s.cursor = new Date(now).toISOString();
  Object.assign(p, { permissions: [], questions: [], inbox: [], awayUntil: until, awayStartedAt: now, ownerInstance: instance, ownerSeen: now, ended: undefined });
}

export interface Life {
  dir: string;
  key: string;
  instance: string;
  now(): number;
  /** "one": going away here ends every other away project (handover). */
  sessions?: "several" | "one";
  /** Tell this server's Claude its away mode ended elsewhere (expiry or handover). */
  cancel?: (reason: "expired" | "handover") => void;
}

/** set_away on for this server's project. Extending an away period keeps its pending items and cursor. Returns the handover notes to send. */
export function beginAway(l: Life, tag: string, until: number): string[] {
  const now = l.now();
  return withStore(l.dir, now, (s) => {
    const notes: string[] = [];
    if (l.sessions === "one") {
      for (const [k, o] of Object.entries(s.projects)) {
        if (k !== l.key && o.awayUntil > now) notes.push(`${tagFor(k, s)} handed over to ${tagFor(l.key, s)}\n${endAway(o, "handover")}`);
      }
    }
    const p = (s.projects[l.key] ??= freshProject(tag));
    if (p.awayUntil > now) Object.assign(p, { awayUntil: until, ownerInstance: l.instance, ownerSeen: now });
    else startAway(s, l.key, until, now, l.instance);
    return notes;
  });
}

/** End this project's away mode in the store; returns the recap. */
export const endProject = (l: Life, reason: EndReason): string =>
  withStore(l.dir, l.now(), (s) => endAway(s.projects[l.key] ?? freshProject(""), reason));

/**
 * Away ended outside this server: the hook (terminal input) can't send, so the owner sends the recap;
 * after an expiry or handover the recap is already out and the owner tells its Claude. Null when nothing to send.
 */
export function endedAtTerminal(l: Life): string | null {
  const done = (p?: ProjectState): p is ProjectState => !!p && p.awayUntil === 0 && p.ownerInstance === l.instance;
  if (!done(readStore(l.dir, l.now()).projects[l.key])) return null; // cheap unlocked look first
  const r = withStore(l.dir, l.now(), (s) => {
    const p = s.projects[l.key];
    if (!done(p)) return null;
    if (!p.ended) return { recap: endAway(p, "terminal") };
    const ended = p.ended;
    Object.assign(p, { ownerInstance: undefined, ended: undefined });
    return { ended };
  });
  if (r?.ended) l.cancel?.(r.ended);
  return r?.recap ?? null;
}
