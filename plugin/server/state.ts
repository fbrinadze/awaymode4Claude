import { freshProject, readStore, withStore } from "./store.ts";

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
});

export const isAway = (s: State, now: number): boolean => s.awayUntil > now;

// This server's own project in the v2 store; index.ts sets it at start, tests use the default.
let mine = { key: "default", tag: "" };
export function setProject(key: string, tag: string): void {
  mine = { key, tag };
}

/** This project's view of state.json: shared pairing and cursor plus its own entry. Fails closed. */
export function load(dir: string): State {
  const s = readStore(dir, Date.now(), mine);
  const p = s.projects[mine.key] ?? freshProject(mine.tag);
  return {
    awayUntil: p.awayUntil, me: s.me, cursor: s.cursor, nextQ: s.nextQ, questions: p.questions,
    permissions: p.permissions, lastSentAt: p.lastSentAt, lastStopAt: p.lastStopAt,
    awayStartedAt: p.awayStartedAt, awaySession: p.sessionId, outbox: p.outbox,
  };
}

/** Write this project's view back under the lock (0600, temp file then rename). */
export function save(dir: string, v: State): void {
  withStore(dir, Date.now(), (s) => {
    Object.assign(s, { me: v.me, cursor: v.cursor, nextQ: v.nextQ });
    const p = s.projects[mine.key] ?? freshProject(mine.tag);
    s.projects[mine.key] = {
      ...p, tag: p.tag || mine.tag, awayUntil: v.awayUntil, questions: v.questions, permissions: v.permissions,
      lastSentAt: v.lastSentAt, lastStopAt: v.lastStopAt, awayStartedAt: v.awayStartedAt,
      sessionId: v.awaySession, outbox: v.outbox,
    };
  }, mine);
}
