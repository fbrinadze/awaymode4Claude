import { randomInt } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Msg } from "./adapters/adapter.ts";
import type { Tool } from "./mcp.ts";
import type { Ctx } from "./tools.ts";

const TTL_MS = 10 * 60_000;

export interface SlackSetupDeps {
  ctx: Ctx;
  dir: string;
  /** Every DM the bot received since `since` (ISO), from anyone. Pairing can't filter by sender: we don't know them yet. */
  readDms(since: string): Promise<Msg[]>;
  /** DM a Slack user as the bot. */
  send(userId: string, text: string): Promise<void>;
  /** Switch to Slack, paired with this user. */
  use(me: string): void;
}

/** An unset userConfig value may arrive empty or as the literal ${user_config.…} placeholder. */
const set = (v: string | undefined): boolean => !!v && !v.includes("${") && !!v.trim();

/** Slack only when both tokens are set; otherwise Teams, as before. */
export const pickPlatform = (env: Record<string, string | undefined>): "slack" | "teams" =>
  set(env.AWAY_SLACK_BOT_TOKEN) && set(env.AWAY_SLACK_APP_TOKEN) ? "slack" : "teams";

const file = (dir: string) => join(dir, "slack.json");

export function loadSlack(dir: string): { me: string } | null {
  try {
    const me = JSON.parse(readFileSync(file(dir), "utf8")).me;
    return typeof me === "string" && me ? { me } : null;
  } catch {
    return null;
  }
}

function saveSlack(dir: string, me: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file(dir), JSON.stringify({ me }, null, 2), { mode: 0o600 });
}

export function setupSlackTool(d: SlackSetupDeps): Tool {
  // Held in memory only: a restart means asking for a new code.
  let pending: { code: string; at: number } | null = null;

  const start = (): string => {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    pending = { code, at: d.ctx.deps.now() };
    return `Tell the user: DM the Away Mode bot in Slack with this code: ${code} (valid for 10 minutes). When they say they've sent it, call setup with step "finish".`;
  };

  async function finish(): Promise<string> {
    const p = pending;
    if (!p) return 'No pairing is in progress. Call setup with step "start".';
    if (d.ctx.deps.now() - p.at > TTL_MS) {
      pending = null;
      return 'The pairing code expired. Call setup with step "start" for a new one.';
    }
    const since = new Date(p.at).toISOString();
    const hit = (await d.readDms(since)).find((m) => m.text.trim() === p.code && m.at >= since);
    if (!hit) return "I didn't see the code in a DM to the Away Mode bot yet. Ask the user to send it exactly as shown, then call finish again.";
    pending = null;
    saveSlack(d.dir, hit.from);
    d.ctx.update((s) => {
      s.me = hit.from;
      s.cursor = new Date(d.ctx.deps.now()).toISOString();
    });
    d.use(hit.from);
    await d.send(hit.from, "Paired");
    return 'Paired. Away Mode is ready. Tell the user to say when they step away (for example "going to lunch, back at 1:30").';
  }

  return {
    name: "setup",
    description:
      'Connect Away Mode to Slack, in order: "start" (returns a 6-digit code for the user to DM to the bot), "finish" (checks the DM and pairs), "verify" (confirms pairing).',
    inputSchema: {
      type: "object",
      properties: { step: { type: "string", enum: ["start", "finish", "verify"] } },
      required: ["step"],
    },
    async run(a) {
      if (a.step === "start") return start();
      if (a.step === "finish") return finish();
      if (a.step === "verify") {
        return d.ctx.current().me ? "Paired. Away Mode is connected to Slack." : 'Not paired yet. Call setup with step "start".';
      }
      throw new Error('step must be "start", "finish" or "verify".');
    },
  };
}
