import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Auth } from "../auth.ts";
import { bearer, call, type Net } from "../http.ts";
import type { Adapter } from "./adapter.ts";
import { graphChat } from "./graph-chat.ts";

export { htmlToText } from "./graph-chat.ts";

/** Saved by setup in ${CLAUDE_PLUGIN_DATA}/teams.json. */
export interface TeamsConfig {
  tenantId: string;
  botId: string;
  /** Graph chat ID of the 1:1 bot chat (19:…), for reading replies. */
  chatId: string;
  /** Paired user's Entra object ID. */
  me: string;
  /** Bot Connector conversation ID (a:…), created on first send. */
  conversationId?: string;
}

// Global Teams endpoint, for bots that never receive an inbound activity (public cloud).
const SMBA = "https://smba.trafficmanager.net/teams/v3/conversations";

const file = (dir: string) => join(dir, "teams.json");

export function loadTeams(dir: string): TeamsConfig | null {
  try {
    return JSON.parse(readFileSync(file(dir), "utf8"));
  } catch {
    return null;
  }
}

export function saveTeams(dir: string, cfg: TeamsConfig): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file(dir), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/** Escape, then keep line breaks: plain markdown would mangle `rm -rf *` and the like. */
const toTeams = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

/** The bot route: Bot Connector sends, Graph reads. */
export function teamsAdapter(dir: string, cfg: TeamsConfig, auth: Auth, net: Net): Adapter {
  const reader = graphChat({ chatId: cfg.chatId, token: () => auth.graphToken(), net });

  async function conversation(): Promise<string> {
    if (cfg.conversationId) return cfg.conversationId;
    const body = {
      bot: { id: `28:${cfg.botId}` },
      isGroup: false,
      members: [{ id: cfg.me }],
      tenantId: cfg.tenantId,
      channelData: { tenant: { id: cfg.tenantId } },
    };
    const r = await call(net, SMBA, bearer(await auth.botToken(), "POST", body));
    cfg.conversationId = String(r.id);
    saveTeams(dir, cfg);
    return cfg.conversationId;
  }

  return {
    async send(text) {
      const url = `${SMBA}/${encodeURIComponent(await conversation())}/activities`;
      await call(net, url, bearer(await auth.botToken(), "POST", { type: "message", textFormat: "xml", text: toTeams(text) }));
    },
    poll: (since) => reader.poll(since),
    async me() {
      return cfg.me;
    },
  };
}
