import type { Json, Net } from "../http.ts";
import { call } from "../http.ts";
import type { Adapter, Msg } from "./adapter.ts";
import { socketClient, type WebSocketLike } from "./slack-socket.ts";

export type { WebSocketLike };

const API = "https://slack.com/api/";
const escape = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Slack over Socket Mode (inbound, outbound websocket only) and the Web API (send). Not live-tested. */
export function slackAdapter(
  cfg: { botToken: string; appToken: string; me: string },
  net: Net,
  openSocket: (url: string) => WebSocketLike,
): Adapter & { start(): Promise<void>; stop(): void } {
  let buffer: Msg[] = [];
  let fatal: Error | null = null;
  let channel: string | null = null;

  async function api(method: string, body: Json): Promise<Json> {
    const res = await call(net, API + method, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.botToken}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    if (res.ok !== true) throw new Error(`Slack ${method} failed: ${String(res.error)}`);
    return res;
  }

  function onEvent(payload: Json): void {
    const e = (payload.event ?? {}) as Json;
    if (e.type !== "message" || e.channel_type !== "im" || e.subtype || e.bot_id) return;
    if (e.user !== cfg.me || typeof e.text !== "string" || typeof e.ts !== "string") return; // sender gate
    buffer.push({ id: e.ts, from: e.user, text: e.text, at: new Date(Number(e.ts) * 1000).toISOString() });
  }

  const socket = socketClient({
    appToken: cfg.appToken,
    net,
    openSocket,
    onEvent,
    onFatal: (err) => {
      fatal = err;
      console.error("away-mode:", err.message);
    },
  });

  return {
    start: socket.start,
    stop: socket.stop,
    async send(text) {
      channel ??= String(((await api("conversations.open", { users: cfg.me })).channel as Json).id);
      await api("chat.postMessage", { channel, text: escape(text) });
    },
    async poll(since) {
      if (fatal) throw fatal;
      const out = buffer.filter((m) => m.at > since).sort((a, b) => (a.at < b.at ? -1 : 1));
      buffer = []; // anything at or before the cursor is already processed
      return out;
    },
    me: async () => cfg.me,
  };
}
