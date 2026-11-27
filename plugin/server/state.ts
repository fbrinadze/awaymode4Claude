import { freshProject, type ProjectState, readStore, type RecapItem, type Store, withStore } from "./store.ts";

export interface Question {
  id: string;
  text: string;
  options: string[];
  /** Epoch ms the question was sent; drives the end-of-day timeout. */
  askedAt?: number;
}

export interface Permission {
  id: string;
  tool: string;
  /** Epoch ms when the request arrived. */
  at: number;
  /** Server instance that raised it; only that server may deliver its verdict. */
  instance?: string;
  /** Full redacted command preview, kept for `more <id>`. */
  preview?: string;
  /** Too long to show inline: approvable only after `more <id>` sent it all. */
  needsMore?: boolean;
  moreSent?: boolean;
}

export interface State {
  /** Epoch ms when away mode ends; 0 = not away. */
  awayUntil: number;
  /** Paired user's platform ID. Empty = unpaired, so every reply is dropped. */
  me: string;
  /** ISO timestamp of the last processed message. */
  cursor: string;
  nextQ: number;
  questions: Question[];
  permissions: Permission[];
  /** Epoch ms Claude last reached the user via ask/notify (server acks don't count). */
  lastSentAt: number;
  /** Epoch ms of the last Stop the hook let through. */
  lastStopAt: number;
  /** Epoch ms away mode was last turned on. */
  awayStartedAt: number;
  /** Claude Code session that turned away mode on (set by the hook); other sessions are left alone. */
  awaySession?: string;
  /** Messages queued by hooks (which can't send) for the server to deliver on its next poll. */
  outbox: { type: string; text: string }[];
  /** Epoch ms until which finished/info notes are held for the recap; 0 = not snoozed. */
  snoozeUntil: number;
  recap: RecapItem[];
}

export const fresh = (): State => ({
  awayUntil: 0,
  me: "",
  cursor: "",
  nextQ: 1,
  questions: [],
  permissions: [],
  lastSentAt: 0,
  lastStopAt: 0,
  awayStartedAt: 0,
  outbox: [],
  snoozeUntil: 0,
  recap: [],
});

export const isAway = (s: State, now: number): boolean => s.awayUntil > now;

// This server's own project in the v2 store; index.ts sets it at start, tests use the default.
let mine = { key: "default", tag: "" };
export function setProject(key: string, tag: string): void {
  mine = { key, tag };
}

/** The tag a new entry for this key gets (only this server's own project has one). */
export const tagOf = (key: string): string => (key === mine.key ? mine.tag : "");

const viewOf = (s: Store, p: ProjectState): State => ({
  awayUntil: p.awayUntil, me: s.me, cursor: s.cursor, nextQ: s.nextQ, questions: p.questions,
  permissions: p.permissions, lastSentAt: p.lastSentAt, lastStopAt: p.lastStopAt,
  awayStartedAt: p.awayStartedAt, awaySession: p.sessionId, outbox: p.outbox,
  snoozeUntil: p.snoozeUntil, recap: p.recap,
});

/** Write a project's view into the (locked) store. */
function putView(s: Store, key: string, tag: string, v: State): void {
  Object.assign(s, { me: v.me, cursor: v.cursor, nextQ: v.nextQ });
  const p = s.projects[key] ?? freshProject(tag);
  s.projects[key] = {
    ...p, tag: p.tag || tag, awayUntil: v.awayUntil, questions: v.questions, permissions: v.permissions,
    lastSentAt: v.lastSentAt, lastStopAt: v.lastStopAt, awayStartedAt: v.awayStartedAt,
    sessionId: v.awaySession, outbox: v.outbox, snoozeUntil: v.snoozeUntil, recap: v.recap,
  };
}

const meOf = (key: string) => ({ key, tag: key === mine.key ? mine.tag : "" });

/** This project's view of state.json: shared pairing and cursor plus its own entry. Fails closed. */
export function load(dir: string, key = mine.key): State {
  const me = meOf(key);
  const s = readStore(dir, Date.now(), me);
  return viewOf(s, s.projects[key] ?? freshProject(me.tag));
}

/** Write this project's view back under the lock (0600, temp file then rename). */
export function save(dir: string, v: State, key = mine.key): void {
  const me = meOf(key);
  withStore(dir, Date.now(), (s) => putView(s, key, me.tag, v), me);
}

/**
 * Read this project's view, change it and write it back inside ONE lock, so a hook or another
 * server's write can't be overwritten by a stale copy. Permissions older than `cutoff` are dropped.
 */
export function updateView(dir: string, key: string, now: number, cutoff: number, fn: (v: State) => void): State {
  const me = meOf(key);
  return withStore(dir, now, (s) => {
    const v = viewOf(s, s.projects[key] ?? freshProject(me.tag));
    v.permissions = v.permissions.filter((p) => p.at > cutoff);
    fn(v);
    putView(s, key, me.tag, v);
    return v;
  }, me);
}
