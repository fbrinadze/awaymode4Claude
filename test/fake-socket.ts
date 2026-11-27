import { slackAdapter } from "../plugin/server/adapters/slack.ts";
import type { WebSocketLike } from "../plugin/server/adapters/slack-socket.ts";
import { fakeNet } from "./fake-net.ts";

/** Records what the adapter sends; tests push server frames with `receive`. */
export class FakeSocket implements WebSocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    queueMicrotask(() => this.onclose?.());
  }
  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  acks = () => this.sent.map((s) => JSON.parse(s).envelope_id);
}

export function socketFactory() {
  const sockets: FakeSocket[] = [];
  const open = (url: string) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    return s;
  };
  return { sockets, open };
}

export type Hit = { path: string; body: unknown; auth?: string };

/** Slack Web API fakes plus a fake socket factory, wired into a real slackAdapter. */
export function slackHarness(cfg: { botToken: string; appToken: string; me: string }) {
  const hits: Hit[] = [];
  const posted: string[] = [];
  const state: { fail: string | null; rate: number } = { fail: null, rate: 0 };
  const sock = socketFactory();
  const f = fakeNet([
    ["apps.connections.open", (r) => (hits.push({ path: "open", body: r.body, auth: r.auth }), { ok: true, url: `wss://fake/${hits.length}` })],
    ["conversations.open", (r) => (hits.push({ path: "dm", body: JSON.parse(r.body), auth: r.auth }), { ok: true, channel: { id: "D1" } })],
    [
      "chat.postMessage",
      (r) => {
        if (state.rate-- > 0) return new Response("", { status: 429, headers: { "retry-after": "2" } });
        const b = JSON.parse(r.body);
        if (state.fail) return { ok: false, error: state.fail };
        posted.push(b.text);
        hits.push({ path: "post", body: b, auth: r.auth });
        return { ok: true };
      },
    ],
  ]);
  return { hits, posted, state, sock, slept: f.slept, slack: slackAdapter(cfg, f.net, sock.open) };
}

export const flush =() => new Promise<void>((r) => setTimeout(r, 0));

/** An events_api envelope carrying a DM message event. */
export const dm = (id: string, ts: string, text: string, extra: Record<string, unknown> = {}, user = "U1") => ({
  envelope_id: id,
  type: "events_api",
  accepts_response_payload: false,
  payload: { event: { type: "message", channel_type: "im", user, text, ts, ...extra } },
});
