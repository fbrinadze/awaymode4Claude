import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Adapter } from "./adapters/adapter.ts";
import { slackAdapter, type WebSocketLike } from "./adapters/slack.ts";
import { loadTeams, teamsAdapter } from "./adapters/teams.ts";
import { createAuth } from "./auth.ts";
import { createAway } from "./away.ts";
import type { Net } from "./http.ts";
import { secretStore } from "./secrets.ts";
import { loadSlack, pickPlatform, setupSlackTool } from "./setup-slack.ts";
import { setupTool } from "./setup.ts";

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
/** The folder name to show in Teams; none when Claude Code was started in the home folder. */
const projectName = (dir: string): string => (resolve(dir) === resolve(homedir()) ? "" : basename(dir));
/** An unset userConfig value may arrive empty or as the literal ${user_config.…} placeholder. */
const setting = (v: string | undefined): string => (v && !v.includes("${") ? v.trim() : "");

const dir = process.env.CLAUDE_PLUGIN_DATA;
if (!dir) {
  console.error("away-mode: CLAUDE_PLUGIN_DATA is not set");
  process.exit(1);
}

const tenantId = setting(process.env.AWAY_TENANT_ID);
const botId = setting(process.env.AWAY_BOT_ID);
const botSecret = setting(process.env.AWAY_BOT_SECRET);
const net: Net = { fetch: (url, init) => fetch(url, init), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
const auth =
  tenantId && botId && botSecret
    ? createAuth({ tenantId, clientId: botId, botSecret }, net, secretStore(dir), Date.now)
    : null;

// Swappable so a successful setup switches platform without a restart.
const slackOn = pickPlatform(process.env) === "slack";
let slack: ReturnType<typeof slackAdapter> | null = null;
/** (Re)open the Slack connection for this user; "" while unpaired. Socket Mode only dials out. */
const startSlack = (me: string): Adapter => {
  slack?.stop();
  const a = slackAdapter(
    { botToken: setting(process.env.AWAY_SLACK_BOT_TOKEN), appToken: setting(process.env.AWAY_SLACK_APP_TOKEN), me },
    net,
    (u) => new WebSocket(u) as unknown as WebSocketLike, // DOM typings differ in handler arity only
  );
  a.start().catch((e) => console.error("away-mode: Slack connection failed:", String(e)));
  return (slack = a);
};
process.on("exit", () => slack?.stop());

const saved = loadTeams(dir);
let current: Adapter = slackOn
  ? startSlack(loadSlack(dir)?.me ?? "")
  : auth && saved
    ? teamsAdapter(dir, saved, auth, net)
    : notSetUp;
const adapter: Adapter = {
  send: (text) => current.send(text),
  poll: (since) => current.poll(since),
  me: () => current.me(),
};

const away = createAway({
  adapter,
  extraTools: (ctx) => [
    slackOn
      ? setupSlackTool({
          ctx,
          dir,
          // Pairing reads code-shaped DMs from anyone; poll stays gated on the paired user.
          readDms: async (since) => (slack ? slack.pairDms(since) : []),
          // The adapter DMs its paired user; use() below has already switched to that user when this runs.
          send: (_to, text) => current.send(text),
          use: (me) => (current = startSlack(me)),
        })
      : setupTool({ ctx, dir, net, auth, tenantId, botId, current: () => current, use: (a) => (current = a) }),
  ],
  dir,
  project: projectName(process.env.CLAUDE_PROJECT_DIR ?? process.cwd()),
  hours: num(process.env.AWAY_HOURS, 9),
  waitMinutes: num(process.env.AWAY_WAIT_MINUTES, 60),
  neverRelay: list(process.env.AWAY_NEVER_RELAY, ["rm -rf", "git push --force", "deploy"]),
  endOfDay: setting(process.env.AWAY_END_OF_DAY_ACTION).toLowerCase() === "safest" ? "safest" : "park",
  now: Date.now,
  sleep: net.sleep,
  write: (line) => void process.stdout.write(line),
});

away.resume();
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (line.trim()) void away.handle(line);
}
