import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import type { Adapter } from "./adapters/adapter.ts";
import { loadTeams, teamsAdapter } from "./adapters/teams.ts";
import { createAuth } from "./auth.ts";
import { createAway } from "./away.ts";
import { doctorTool } from "./doctor.ts";
import type { Net } from "./http.ts";
import { baseTag, projectKey } from "./project.ts";
import { setProject } from "./state.ts";
import { secretStore } from "./secrets.ts";
import { setupTool } from "./setup.ts";

const version = (JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8")) as { version: string }).version;

const fail = async (): Promise<never> => {
  throw new Error("Away Mode isn't connected to Teams yet. Run /away-mode:setup.");
};
const notSetUp: Adapter = { send: fail, poll: fail, me: fail };

/** userConfig arrives as strings; anything unusable falls back to the default. */
const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** Comma-separated setting; unset falls back to the defaults, an explicit empty list means none. */
const list = (v: string | undefined, fallback: string[]): string[] => {
  if (v === undefined || v.includes("${")) return fallback;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
};
/** An unset userConfig value may arrive empty or as the literal ${user_config.…} placeholder. */
const setting = (v: string | undefined): string => (v && !v.includes("${") ? v.trim() : "");

const dir = process.env.CLAUDE_PLUGIN_DATA;
if (!dir) {
  console.error("away-mode: CLAUDE_PLUGIN_DATA is not set");
  process.exit(1);
}
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const tag = baseTag(projectDir, homedir());
setProject(projectKey(projectDir), tag);

const tenantId = setting(process.env.AWAY_TENANT_ID);
const botId = setting(process.env.AWAY_BOT_ID);
const botSecret = setting(process.env.AWAY_BOT_SECRET);
const net: Net = { fetch: (url, init) => fetch(url, init), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
const auth =
  tenantId && botId && botSecret
    ? createAuth({ tenantId, clientId: botId, botSecret }, net, secretStore(dir), Date.now)
    : null;

// Swappable so a successful setup switches to Teams without a restart.
const saved = loadTeams(dir);
let current: Adapter = auth && saved ? teamsAdapter(dir, saved, auth, net) : notSetUp;
const adapter: Adapter = {
  send: (text) => current.send(text),
  poll: (since) => current.poll(since),
  me: () => current.me(),
};

const away = createAway({
  adapter,
  extraTools: (ctx) => [
    setupTool({ ctx, dir, net, auth, tenantId, botId, current: () => current, use: (a) => (current = a) }),
    doctorTool({ dir, net, auth, tenantId, botId, hasSecret: !!botSecret, now: Date.now, version, bunVersion: Bun.version, current: () => current }),
  ],
  dir,
  key: projectKey(projectDir),
  project: tag,
  hours: num(process.env.AWAY_HOURS, 9),
  waitMinutes: num(process.env.AWAY_WAIT_MINUTES, 60),
  neverRelay: list(process.env.AWAY_NEVER_RELAY, ["rm -rf", "git push --force", "deploy"]),
  endOfDay: setting(process.env.AWAY_END_OF_DAY_ACTION).toLowerCase() === "safest" ? "safest" : "park",
  sessions: setting(process.env.AWAY_SESSIONS).toLowerCase() === "one" ? "one" : "several",
  replyRouting: setting(process.env.AWAY_REPLY_ROUTING).toLowerCase() === "on",
  now: Date.now,
  sleep: net.sleep,
  write: (line) => void process.stdout.write(line),
});

away.resume();
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (line.trim()) void away.handle(line);
}
