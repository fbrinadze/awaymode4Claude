import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAway } from "../plugin/server/away.ts";
import type { Json } from "../plugin/server/mcp.ts";
import { projectKey } from "../plugin/server/project.ts";
import { withStore } from "../plugin/server/store.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const T = Date.parse("2026-11-26T18:00:00Z");

function server(dir: string, path: string) {
  const fake = new FakeAdapter("user-1");
  let polls = 0;
  const poll = fake.poll.bind(fake);
  fake.poll = async (since) => (polls++, poll(since));
  const out: Json[] = [];
  const away = createAway({
    adapter: fake, dir, key: projectKey(path), project: path.slice(1), hours: 9, waitMinutes: 60,
    now: () => T, sleep: () => new Promise(() => {}), write: (l) => void out.push(JSON.parse(l)),
  });
  const setAway = () =>
    away.handle(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "set_away", arguments: { on: true } } }));
  const channel = () => out.filter((m) => m.method === "notifications/claude/channel").map((m) => m.params as Json);
  return { fake, away, setAway, channel, polls: () => polls, resetPolls: () => void (polls = 0) };
}

test("two servers, one poll: the holder fetches, the target delivers from its inbox", async () => {
  const dir = mkdtempSync(join(tmpdir(), "away-"));
  withStore(dir, T, (s) => void (s.me = "user-1"));
  const a = server(dir, "/a");
  const b = server(dir, "/b");
  await a.setAway();
  await b.setAway();
  await new Promise((r) => setTimeout(r, 20));
  a.resetPolls();
  b.resetPolls();
  a.fake.reply("@b ping", T);
  b.fake.reply("@b ping", T);
  await a.away.pollOnce();
  await b.away.pollOnce();
  expect(b.channel().map((c) => c.content)).toEqual(["ping"]);
  expect(a.channel()).toEqual([]);
  expect(a.polls() + b.polls()).toBe(1);
});
