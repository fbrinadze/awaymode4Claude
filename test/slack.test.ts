import { beforeEach, expect, test } from "bun:test";
import type { slackAdapter } from "../plugin/server/adapters/slack.ts";
import { dm, flush, type Hit, slackHarness, type socketFactory } from "./fake-socket.ts";

const CFG = { botToken: "xoxb-test", appToken: "xapp-test", me: "U1" };
const EPOCH = "2000-01-01T00:00:00Z";
let h: ReturnType<typeof slackHarness>;
let hits: Hit[], posted: string[], sock: ReturnType<typeof socketFactory>, slept: number[], slack: ReturnType<typeof slackAdapter>;

beforeEach(() => {
  h = slackHarness(CFG);
  ({ hits, posted, sock, slept, slack } = h);
});
const fail = (code: string) => void (h.state.fail = code);
const rateLimit = (n: number) => void (h.state.rate = n);

const opens = () => hits.filter((h) => h.path === "open");

test("connections.open uses the app token and the socket gets the returned URL", async () => {
  await slack.start();
  expect(opens()[0]?.auth).toBe("Bearer xapp-test");
  expect(sock.sockets[0]?.url).toBe("wss://fake/1");
  slack.stop();
});

test("each envelope is acked, duplicates are ignored", async () => {
  await slack.start();
  const s = sock.sockets[0]!;
  s.receive(dm("e1", "1788000000.000100", "hi"));
  s.receive(dm("e1", "1788000000.000100", "hi"));
  s.receive(dm("e2", "1788000001.000100", "again"));
  expect(s.acks()).toEqual(["e1", "e1", "e2"]);
  expect((await slack.poll(EPOCH)).map((m) => m.id)).toEqual(["1788000000.000100", "1788000001.000100"]);
  slack.stop();
});

test("ack goes out even for an event that is dropped", async () => {
  await slack.start();
  const s = sock.sockets[0]!;
  s.receive(dm("e1", "1788000000.1", "x", {}, "U2"));
  expect(s.acks()).toEqual(["e1"]);
  expect(await slack.poll(EPOCH)).toEqual([]);
  slack.stop();
});

test("subtype, bot, non-im and other-user messages are dropped", async () => {
  await slack.start();
  const s = sock.sockets[0]!;
  s.receive(dm("a", "1788000000.1", "edited", { subtype: "message_changed" }));
  s.receive(dm("b", "1788000000.2", "bot", { bot_id: "B1" }));
  s.receive(dm("c", "1788000000.3", "chan", { channel_type: "channel" }));
  s.receive(dm("d", "1788000000.4", "stranger", {}, "U2"));
  s.receive({ envelope_id: "f", type: "slash_commands", payload: {} });
  s.receive(dm("g", "1788000000.5", "ok"));
  const got = await slack.poll(EPOCH);
  expect(got).toEqual([{ id: "1788000000.5", from: "U1", text: "ok", at: new Date(1788000000500).toISOString() }]);
  slack.stop();
});

test("poll filters by since, drains, and never blocks", async () => {
  await slack.start();
  const s = sock.sockets[0]!;
  expect(await slack.poll(EPOCH)).toEqual([]);
  s.receive(dm("a", "1788000002.0", "late"));
  s.receive(dm("b", "1788000001.0", "mid"));
  const since = new Date(1788000000000).toISOString();
  expect((await slack.poll(since)).map((m) => m.text)).toEqual(["mid", "late"]);
  expect(await slack.poll(since)).toEqual([]);
  slack.stop();
});

test("a disconnect frame reconnects with a fresh connections.open", async () => {
  await slack.start();
  sock.sockets[0]!.receive({ type: "disconnect", reason: "refresh_requested" });
  await flush();
  expect(opens()).toHaveLength(2);
  expect(sock.sockets[1]?.url).toBe("wss://fake/2");
  expect(slept[0]).toBe(1000);
  slack.stop();
});

test("a socket close reconnects, and backoff doubles on repeated drops", async () => {
  await slack.start();
  sock.sockets[0]!.onclose?.();
  await flush();
  sock.sockets[1]!.onclose?.();
  await flush();
  expect(opens()).toHaveLength(3);
  expect(slept.slice(0, 2)).toEqual([1000, 2000]);
  slack.stop();
});

test("hello resets the backoff", async () => {
  await slack.start();
  sock.sockets[0]!.onclose?.();
  await flush();
  sock.sockets[1]!.receive({ type: "hello" });
  sock.sockets[1]!.onclose?.();
  await flush();
  expect(slept.slice(0, 2)).toEqual([1000, 1000]);
  slack.stop();
});

test("stop() halts reconnecting and closes the socket", async () => {
  await slack.start();
  slack.stop();
  sock.sockets[0]!.onclose?.();
  await flush();
  expect(opens()).toHaveLength(1);
  expect(sock.sockets[0]!.closed).toBe(true);
});

test("link_disabled stops reconnecting and poll surfaces the error", async () => {
  await slack.start();
  sock.sockets[0]!.receive({ type: "disconnect", reason: "link_disabled" });
  await flush();
  expect(opens()).toHaveLength(1);
  await expect(slack.poll(EPOCH)).rejects.toThrow(/link_disabled/);
});

test("send opens the DM once and posts escaped text", async () => {
  await slack.send("a < b & c > d");
  await slack.send("second");
  expect(hits.filter((h) => h.path === "dm")).toHaveLength(1);
  expect(hits.find((h) => h.path === "dm")).toMatchObject({ body: { users: "U1" }, auth: "Bearer xoxb-test" });
  expect(posted).toEqual(["a &lt; b &amp; c &gt; d", "second"]);
  expect(hits.find((h) => h.path === "post")?.body).toMatchObject({ channel: "D1" });
});

test("ok:false throws the Slack error code without the token", async () => {
  fail("channel_not_found");
  const err = await slack.send("x").catch((e: Error) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toContain("channel_not_found");
  expect((err as Error).message).not.toContain("xoxb-test");
});

test("429 then success goes through", async () => {
  rateLimit(1);
  await slack.send("hello");
  expect(posted).toEqual(["hello"]);
  expect(slept).toEqual([2000]);
});

test("me() is the configured user", async () => {
  expect(await slack.me()).toBe("U1");
});
