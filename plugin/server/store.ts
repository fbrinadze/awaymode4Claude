// state.json v2: shared fields plus one entry per project, written only under state.lock.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lock } from "./lock.ts";
import type { Action } from "./route.ts";
import type { Permission, Question } from "./state.ts";

export interface InboxItem {
  action: Action;
  at: string;
}
export interface RecapItem {
  kind: "finished" | "info" | "parked" | "question" | "approval";
  text: string;
}
export interface ProjectState {
  tag: string;
  /** Server instance that owns delivery for this project (set by set_away in that server). */
  ownerInstance?: string;
  /** Epoch ms the owner last showed it was alive. */
  ownerSeen: number;
  /** Claude Code session that owns the project (set by the hook). */
  sessionId?: string;
  awayUntil: number;
  awayStartedAt: number;
  snoozeUntil: number;
  questions: Question[];
  permissions: Permission[];
  outbox: { type: string; text: string }[];
  recap: RecapItem[];
  inbox: InboxItem[];
  lastSentAt: number;
  lastStopAt: number;
  /** Ended by expiry or handover elsewhere: the owner still has to tell its Claude (ownerInstance is kept until then). */
  ended?: "expired" | "handover";
}
export interface Store {
  version: 2;
  me: string;
  cursor: string;
  nextQ: number;
  lease: { owner: string; until: number } | null;
  projects: Record<string, ProjectState>;
}

export { LOCK_STALE_MS, LOCK_WAIT_MS, StateBusy } from "./lock.ts";

export const freshProject = (tag: string): ProjectState => ({
  tag, ownerSeen: 0, awayUntil: 0, awayStartedAt: 0, snoozeUntil: 0,
  questions: [], permissions: [], outbox: [], recap: [], inbox: [], lastSentAt: 0, lastStopAt: 0,
});
export const freshStore = (): Store => ({ version: 2, me: "", cursor: "", nextQ: 1, lease: null, projects: {} });

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const opt = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const arr = <T>(v: unknown, ok: (x: Obj) => boolean = () => true): T[] =>
  Array.isArray(v) ? (v.filter((x) => isObj(x) && ok(x)) as T[]) : [];
const hasId = (x: Obj) => typeof x.id === "string";

function project(v: unknown): ProjectState {
  const p = isObj(v) ? v : {};
  return {
    tag: str(p.tag), ownerInstance: opt(p.ownerInstance), ownerSeen: num(p.ownerSeen), sessionId: opt(p.sessionId),
    awayUntil: num(p.awayUntil), awayStartedAt: num(p.awayStartedAt), snoozeUntil: num(p.snoozeUntil),
    questions: arr(p.questions, hasId), permissions: arr(p.permissions, hasId), outbox: arr(p.outbox),
    recap: arr(p.recap), inbox: arr(p.inbox), lastSentAt: num(p.lastSentAt), lastStopAt: num(p.lastStopAt),
    ended: p.ended === "expired" || p.ended === "handover" ? p.ended : undefined,
  };
}

/**
 * Ended (awayUntil 0) with nothing pending: a finished or renamed project's leftover entry.
 * No clock here: expiry by time is the lifecycle sweep's job, with the injected clock.
 */
const idle = (p: ProjectState) =>
  p.awayUntil === 0 && !p.ownerInstance && !p.questions.length && !p.permissions.length && !p.inbox.length && !p.outbox.length && !p.recap.length;

/** v1 kept everything at the top level. Keep the pairing; pending items from before can't be trusted. */
function migrate(v: Obj, to?: { key: string; tag: string }): Store {
  const s = { ...freshStore(), me: str(v.me), cursor: str(v.cursor), nextQ: num(v.nextQ, 1) };
  if (to) {
    const p = { ...project(v), tag: to.tag, questions: [], permissions: [], sessionId: opt(v.awaySession) };
    s.projects[to.key] = p;
  }
  return s;
}

const file = (dir: string) => join(dir, "state.json");

/** Missing or corrupt state loads empty and unpaired, so it fails closed. No lock: for readers. */
export function readStore(dir: string, _now: number, migrateTo?: { key: string; tag: string }): Store {
  let v: unknown;
  try {
    v = JSON.parse(readFileSync(file(dir), "utf8"));
  } catch {
    return freshStore();
  }
  if (!isObj(v)) return freshStore();
  if (v.version !== 2) return migrate(v, migrateTo);
  const lease = isObj(v.lease) && typeof v.lease.owner === "string" ? { owner: v.lease.owner, until: num(v.lease.until) } : null;
  const projects: Record<string, ProjectState> = {};
  for (const [k, p] of Object.entries(isObj(v.projects) ? v.projects : {})) {
    const ps = project(p);
    if (!idle(ps)) projects[k] = ps;
  }
  return { version: 2, me: str(v.me), cursor: str(v.cursor), nextQ: num(v.nextQ, 1), lease, projects };
}

/** Lock, read, change, write (temp file, 0600, rename), unlock. */
export function withStore<T>(dir: string, now: number, fn: (s: Store) => T, migrateTo?: { key: string; tag: string }): T {
  mkdirSync(dir, { recursive: true });
  const held = lock(dir);
  try {
    const s = readStore(dir, now, migrateTo);
    const out = fn(s);
    const tmp = `${file(dir)}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    renameSync(tmp, file(dir));
    return out;
  } finally {
    rmSync(held, { force: true });
  }
}
