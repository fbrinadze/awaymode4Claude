import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Auth } from "../auth.ts";
import { bearer, call, type Net } from "../http.ts";
import type { Adapter, Msg } from "./adapter.ts";

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
const GRAPH = "https://graph.microsoft.com/v1.0";

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

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** Teams sends HTML bodies; Claude gets plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e] ?? "")
    .trim();
}

/** Escape, then keep line breaks: plain markdown would mangle `rm -rf *` and the like. */
const toTeams = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

interface GraphMsg {
  id: string;
  messageType?: string;
  createdDateTime?: string;
  lastModifiedDateTime: string;
  lastEditedDateTime?: string | null;
  deletedDateTime?: string | null;
  from?: { user?: { id?: string } | null } | null;
  body?: { content?: string };
}

/** A fresh reply from a person: not the bot, not a system event, not an edit or deletion. */
const isReply = (m: GraphMsg): boolean =>
  m.messageType === "message" && !!m.from?.user?.id && !m.deletedDateTime && !m.lastEditedDateTime;

export function teamsAdapter(dir: string, cfg: TeamsConfig, auth: Auth, net: Net): Adapter {
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

    // ponytail: one page of 50 is plenty at a 5-60 s interval; follow @odata.nextLink if bursts ever exceed it.
    async poll(since) {
      // Graph ignores $filter unless $orderby names the same property, and only sorts descending.
      const q = new URLSearchParams({ $top: "50", $orderby: "lastModifiedDateTime desc" });
      if (since) q.set("$filter", `lastModifiedDateTime gt ${since}`);
      const r = await call(net, `${GRAPH}/chats/${encodeURIComponent(cfg.chatId)}/messages?${q}`, bearer(await auth.graphToken()));
      const page = ((r.value ?? []) as GraphMsg[]).slice().reverse();
      return page.filter(isReply).map(
        (m): Msg => ({
          id: m.id, from: m.from!.user!.id!, text: htmlToText(m.body?.content ?? ""),
          at: m.lastModifiedDateTime, sentAt: m.createdDateTime,
        }),
      );
    },

    async me() {
      return cfg.me;
    },
  };
}
