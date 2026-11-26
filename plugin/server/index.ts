import { basename } from "node:path";
import { createInterface } from "node:readline";
import type { Adapter } from "./adapters/adapter.ts";
import { createAway } from "./away.ts";

// Replaced by the Teams adapter in Phase 2.
const fail = async (): Promise<never> => {
  throw new Error("Away Mode isn't set up yet. Run /away-mode:setup.");
};
const notSetUp: Adapter = { send: fail, poll: fail, me: fail };

/** userConfig arrives as strings; anything unusable falls back to the default. */
const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const dir = process.env.CLAUDE_PLUGIN_DATA;
if (!dir) {
  console.error("away-mode: CLAUDE_PLUGIN_DATA is not set");
  process.exit(1);
}

const away = createAway({
  adapter: notSetUp,
  dir,
  project: basename(process.env.CLAUDE_PROJECT_DIR ?? process.cwd()),
  hours: num(process.env.AWAY_HOURS, 9),
  waitMinutes: num(process.env.AWAY_WAIT_MINUTES, 60),
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  write: (line) => void process.stdout.write(line),
});

away.resume();
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (line.trim()) void away.handle(line);
}
