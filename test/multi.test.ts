import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAway, type Deps } from "../plugin/server/away.ts";
import type { Json } from "../plugin/server/mcp.ts";
import { projectKey, tagFor } from "../plugin/server/project.ts";
import { withStore } from "../plugin/server/store.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const T = Date.parse("2026-11-26T18:00:00Z");

function server(dir: string, path: string, extra: Partial<Deps> = {}) {
  const fake = new FakeAdapter("user-1");
  let polls = 0;
  const poll = fake.poll.bind(fake);
  fake.poll = async (since) => (polls++, poll(since));
  const out: Json[] = [];
  const away = createAway({
    adapter: fake, dir, key: projectKey(path), project: path.slice(1), hours: 9, waitMinutes: 60,
    now: () => T, sleep: () => new Promise(() => {}), write: (l) => void out.push(JSON.parse(l)), ...extra,
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

const tagOf = (dir: string, path: string) => withStore(dir, T, (s) => tagFor(projectKey(path), s));
const awayUntil = (dir: string, path: string) => withStore(dir, T, (s) => s.projects[projectKey(path)]?.awayUntil ?? 0);

test("sessions=one: going away in b hands over from a, with a's recap sent to Teams", async () => {
  const dir = mkdtempSync(join(tmpdir(), "away-"));
  withStore(dir, T, (s) => void (s.me = "user-1"));
  const a = server(dir, "/a", { sessions: "one" });
  const b = server(dir, "/b", { sessions: "one" });
  await a.setAway();
  withStore(dir, T, (s) => void s.projects[projectKey("/a")]!.recap.push({ kind: "finished", text: "built the thing" }));
  await b.setAway();
  expect(awayUntil(dir, "/a")).toBe(0);
  expect(awayUntil(dir, "/b")).toBeGreaterThan(T);
  const text = b.fake.sent.join(" | ");
  expect(text).toContain(`${tagOf(dir, "/a")} handed over to ${tagOf(dir, "/b")}`);
  expect(text).toContain("built the thing");
});

test("sessions=several (default): both projects stay away", async () => {
  const dir = mkdtempSync(join(tmpdir(), "away-"));
  const a = server(dir, "/a");
  const b = server(dir, "/b");
  await a.setAway();
  await b.setAway();
  expect(awayUntil(dir, "/a")).toBeGreaterThan(T);
  expect(awayUntil(dir, "/b")).toBeGreaterThan(T);
  expect(b.fake.sent.join(" | ")).not.toContain("handed over");
});

test("replyRouting from settings reaches dispatch: a quoted reply goes to its project", async () => {
  const dir = mkdtempSync(join(tmpdir(), "away-"));
  withStore(dir, T, (s) => void (s.me = "user-1"));
  const a = server(dir, "/a", { replyRouting: true });
  const b = server(dir, "/b", { replyRouting: true });
  await a.setAway();
  await b.setAway();
  await new Promise((r) => setTimeout(r, 20));
  for (const x of [a, b]) x.fake.inbox.push({ id: "m1", from: "user-1", text: "go ahead", at: new Date(T + 1).toISOString(), replyTag: tagOf(dir, "/b") });
  await a.away.pollOnce();
  await b.away.pollOnce();
  expect(b.channel().map((c) => c.content)).toEqual(["go ahead"]);
  expect(a.channel()).toEqual([]);
});
