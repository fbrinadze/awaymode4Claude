import { expect, test } from "bun:test";
import { slackAdapter } from "../plugin/server/adapters/slack.ts";
import { fakeNet } from "./fake-net.ts";
import { flush, socketFactory } from "./fake-socket.ts";

const CFG = { botToken: "xoxb-test", appToken: "xapp-test", me: "U1" };

test("a failed connection at boot is retried with backoff", async () => {
  let n = 0;
  const f = fakeNet([
    ["apps.connections.open", () => {
      if (n++ === 0) throw new Error("network down");
      return { ok: true, url: "wss://fake/2" };
    }],
  ]);
  const sock = socketFactory();
  const slack = slackAdapter(CFG, f.net, sock.open);
  await slack.start();
  await flush();
  expect(f.slept).toEqual([1000]);
  expect(sock.sockets.map((s) => s.url)).toEqual(["wss://fake/2"]);
  slack.stop();
});

test("a permanent auth error stops retrying and poll surfaces it", async () => {
  const f = fakeNet([["apps.connections.open", () => ({ ok: false, error: "invalid_auth" })]]);
  const sock = socketFactory();
  const slack = slackAdapter(CFG, f.net, sock.open);
  await slack.start();
  await flush();
  expect(f.calls.length).toBe(1);
  expect(f.slept).toEqual([]);
  await expect(slack.poll("2000-01-01T00:00:00Z")).rejects.toThrow("invalid_auth");
});
