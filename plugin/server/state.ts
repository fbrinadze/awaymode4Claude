import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Question {
  id: string;
  text: string;
  options: string[];
}

export interface Permission {
  id: string;
  tool: string;
  /** Epoch ms when the request arrived. */
  at: number;
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
}

export const fresh = (): State => ({
  awayUntil: 0,
  me: "",
  cursor: "",
  nextQ: 1,
  questions: [],
  permissions: [],
});

export const isAway = (s: State, now: number): boolean => s.awayUntil > now;

const file = (dir: string) => join(dir, "state.json");

/** Missing or corrupt state loads as fresh: unpaired, so it fails closed. */
export function load(dir: string): State {
  try {
    return { ...fresh(), ...JSON.parse(readFileSync(file(dir), "utf8")) };
  } catch {
    return fresh();
  }
}

/** Write to a temp file then rename, so a hook never reads half a file. */
export function save(dir: string, s: State): void {
  mkdirSync(dir, { recursive: true });
  const tmp = `${file(dir)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  renameSync(tmp, file(dir));
}
