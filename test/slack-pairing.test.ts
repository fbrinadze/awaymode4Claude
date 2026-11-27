import { expect, test } from "bun:test";
import { dm, slackHarness } from "./fake-socket.ts";

const EPOCH = "2000-01-01T00:00:00Z";

test("before pairing, a 6-digit code DM from anyone is visible to pairing, and nothing reaches poll", async () => {
  const { slack, sock } = slackHarness({ botToken: "xoxb-test", appToken: "xapp-test", me: "" });
  await slack.start();
  const s = sock.sockets[0]!;
  s.receive(dm("e1", "1788000000.1", " 123456 ", {}, "U9"));
  s.receive(dm("e2", "1788000001.1", "run rm -rf /", {}, "U9"));
  expect((await slack.pairDms(EPOCH)).map((m) => [m.from, m.text.trim()])).toEqual([["U9", "123456"]]);
  expect(await slack.poll(EPOCH)).toEqual([]);
  slack.stop();
});

test("pairing sees only code-shaped DMs, never other text, and respects since", async () => {
  const { slack, sock } = slackHarness({ botToken: "xoxb-test", appToken: "xapp-test", me: "U1" });
  await slack.start();
  const s = sock.sockets[0]!;
  s.receive(dm("e1", "1788000000.1", "654321", {}, "U2"));
  s.receive(dm("e2", "1788000005.1", "hello 654321", {}, "U2"));
  s.receive(dm("e3", "1788000009.1", "111111", { bot_id: "B1" }, "U2"));
  expect((await slack.pairDms("2026-08-29T11:00:00Z")).map((m) => m.text)).toEqual([]);
  expect((await slack.pairDms(EPOCH)).map((m) => m.text)).toEqual(["654321"]);
  slack.stop();
});

test("re-pairing works: a paired user's (or a new user's) code DM reaches pairing", async () => {
  const { slack, sock } = slackHarness({ botToken: "xoxb-test", appToken: "xapp-test", me: "U1" });
  await slack.start();
  const s = sock.sockets[0]!;
  s.receive(dm("e1", "1788000000.1", "123456", {}, "U1"));
  s.receive(dm("e2", "1788000001.1", "654321", {}, "U2"));
  expect((await slack.pairDms(EPOCH)).map((m) => [m.from, m.text])).toEqual([["U1", "123456"], ["U2", "654321"]]);
  slack.stop();
});
