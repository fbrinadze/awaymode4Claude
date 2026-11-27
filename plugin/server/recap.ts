// Clean away start and end (spec 5.6 R2/R3, 6.4): one place that resets a project's away state.
import { freshProject, type ProjectState, readStore, type RecapItem, type Store, withStore } from "./store.ts";

export type EndReason = "expired" | "back" | "terminal" | "off" | "handover";

const bullets = (title: string, lines: string[]): string[] => (lines.length ? [`${title}:`, ...lines.map((l) => `- ${l}`)] : []);
const texts = (p: ProjectState, ...kinds: RecapItem["kind"][]) => p.recap.filter((r) => kinds.includes(r.kind)).map((r) => r.text);

/** The recap text, then the project is left clean: nothing pending, no session, no owner, not away. */
export function endAway(p: ProjectState, reason: EndReason): string {
  const text = [
    reason === "terminal" ? "You're back at the terminal." : `Away ended (${reason}).`,
    ...bullets("Finished", texts(p, "finished", "info")),
    ...bullets("Still waiting (cancelled)", p.permissions.map((x) => `${x.tool} ${x.id}`)),
    ...bullets("Unanswered", p.questions.map((q) => `${q.id}: ${q.text}`)),
    ...bullets("Parked", texts(p, "parked")),
  ].join("\n");
  Object.assign(p, { permissions: [], questions: [], inbox: [], recap: [], ownerInstance: undefined, sessionId: undefined, awayUntil: 0 });
  return text;
}

/** A new away period: earlier replies and pending items aren't for it. The cursor moves only if no other project is away. */
export function startAway(s: Store, key: string, until: number, now: number, instance: string): void {
  const p = s.projects[key];
  if (!p) throw new Error(`No project ${key}.`);
  const othersAway = Object.entries(s.projects).some(([k, o]) => k !== key && o.awayUntil > now);
  if (!othersAway) s.cursor = new Date(now).toISOString();
  Object.assign(p, { permissions: [], questions: [], inbox: [], awayUntil: until, awayStartedAt: now, ownerInstance: instance, ownerSeen: now });
}

export interface Life {
  dir: string;
  key: string;
  instance: string;
  now(): number;
}

/** set_away on for this server's project. Extending an away period keeps its pending items and cursor. */
export function beginAway(l: Life, tag: string, until: number): void {
  const now = l.now();
  withStore(l.dir, now, (s) => {
    const p = (s.projects[l.key] ??= freshProject(tag));
    if (p.awayUntil > now) Object.assign(p, { awayUntil: until, ownerInstance: l.instance, ownerSeen: now });
    else startAway(s, l.key, until, now, l.instance);
  });
}

/** End this project's away mode in the store; returns the recap. */
export const endProject = (l: Life, reason: EndReason): string =>
  withStore(l.dir, l.now(), (s) => endAway(s.projects[l.key] ?? freshProject(""), reason));

/** The hook cleared awayUntil but can't send: the owning server finishes the job. Null when there is nothing to end. */
export function endedAtTerminal(l: Life): string | null {
  const done = (p?: ProjectState) => !!p && p.awayUntil === 0 && p.ownerInstance === l.instance;
  if (!done(readStore(l.dir, l.now()).projects[l.key])) return null; // cheap unlocked look first
  return withStore(l.dir, l.now(), (s) => {
    const p = s.projects[l.key];
    return p && p.awayUntil === 0 && p.ownerInstance === l.instance ? endAway(p, "terminal") : null;
  });
}
