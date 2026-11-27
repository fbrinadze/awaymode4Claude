import { call, type Json, type Net } from "../http.ts";

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

interface Opts {
  appToken: string;
  net: Net;
  openSocket: (url: string) => WebSocketLike;
  /** Called with each envelope payload, after the ack has gone out. */
  onEvent: (payload: Json) => void;
  /** Called once when Slack disables the link; reconnecting stops. */
  onFatal: (err: Error) => void;
}

const OPEN_URL = "https://slack.com/api/apps.connections.open";

/** Socket Mode connection: opens, acks every envelope, dedupes, reconnects with backoff. */
export function socketClient(o: Opts) {
  const seen = new Set<string>();
  const remember = (id: string): void => {
    seen.add(id);
    if (seen.size > 1000) seen.delete(seen.values().next().value as string);
  };
  let stopped = false;
  let delay = 1000;
  let ws: WebSocketLike | null = null;

  async function open(): Promise<void> {
    const res = await call(o.net, OPEN_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${o.appToken}`, "content-type": "application/x-www-form-urlencoded" },
    });
    if (res.ok !== true) throw new Error(`Slack apps.connections.open failed: ${String(res.error)}`);
    if (stopped) return;
    attach(o.openSocket(String(res.url)));
  }

  function attach(sock: WebSocketLike): void {
    ws = sock;
    let dead = false;
    const drop = (): void => {
      if (dead || sock !== ws) return;
      dead = true;
      void reconnect();
    };
    sock.onmessage = (ev) => frame(sock, ev.data, drop);
    sock.onclose = drop;
    sock.onerror = (e) => {
      console.error("away-mode: Slack socket error", e instanceof Error ? e.message : "");
      drop();
    };
  }

  function frame(sock: WebSocketLike, data: string, drop: () => void): void {
    let m: Json;
    try {
      m = JSON.parse(data) as Json;
    } catch {
      return;
    }
    if (typeof m.envelope_id === "string") {
      sock.send(JSON.stringify({ envelope_id: m.envelope_id })); // ack first, always
      if (seen.has(m.envelope_id)) return;
      remember(m.envelope_id);
      if (m.type === "events_api") o.onEvent((m.payload ?? {}) as Json);
    } else if (m.type === "hello") delay = 1000;
    else if (m.type === "disconnect") {
      if (m.reason === "link_disabled") {
        stopped = true;
        o.onFatal(new Error("Slack disconnect: link_disabled (Socket Mode is disabled for this app)"));
      }
      sock.close();
      drop();
    }
  }

  async function reconnect(): Promise<void> {
    while (!stopped) {
      await o.net.sleep(delay);
      delay = Math.min(delay * 2, 60_000);
      if (stopped) return;
      try {
        return await open();
      } catch (e) {
        console.error("away-mode: Slack reconnect failed:", (e as Error).message);
      }
    }
  }

  return {
    start: open,
    stop(): void {
      stopped = true;
      ws?.close();
    },
  };
}
