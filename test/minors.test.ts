// Deferred review minors from v1.1.0 (M1, M2, M5, M6, M8).
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAway, type Deps } from "../plugin/server/away.ts";
import type { Json } from "../plugin/server/mcp.ts";
import { projectKey } from "../plugin/server/project.ts";
import { withStore } from "../plugin/server/store.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const T = Date.parse("2026-11-26T18:00:00Z");
const MIN = 60_000;
const clock = { now: T };

function server(dir: string, path: string, extra: Partial<Deps> = {}) {
  const fake = new FakeAdapter("user-1");
  let polls = 0;
  const poll = fake.poll.bind(fake);
  fake.poll = async (since) => (polls++, poll(since));
  const out: Json[] = [];
  const away = createAway({
    adapter: fake, dir, key: projectKey(path), project: path.slice(1), hours: 9, waitMinutes: 60,
    now: () => clock.now, sleep: () => new Promise(() => {}), write: (l) => void out.push(JSON.parse(l)), ...extra,
  });
  let id = 0;
  const tool = (name: string, args: Json) =>
    away.handle(JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }));
  const backs = () => out.filter((m) => m.method === "notifications/claude/channel" && (m.params as any).meta?.kind === "back");
  return { fake, away, tool, backs, polls: () => polls };
}
function store() {
  clock.now = T;
  const dir = mkdtempSync(join(tmpdir(), "away-"));
  withStore(dir, T, (s) => void (s.me = "user-1"));
  return dir;
}
const entry = (dir: string, path: string) => withStore(dir, clock.now, (s) => s.projects[projectKey(path)]);

test("M6: a secret for another project is never written to its inbox in state.json", async () => {
  const dir = store();
  const a = server(dir, "/a");
  const b = server(dir, "/b");
  await a.tool("set_away", { on: true });
  await b.tool("set_away", { on: true });
  const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
  a.fake.reply(`@b ${secret}`, T);
  await a.away.pollOnce();
  expect(readFileSync(join(dir, "state.json"), "utf8")).not.toContain(secret);
});

test("M8: when away expires, the owner tells its Claude that Teams answers are cancelled, once", async () => {
  const dir = store();
  const a = server(dir, "/a");
  await a.tool("set_away", { on: true, minutes: 30 });
  clock.now = T + 31 * MIN;
  await a.away.pollOnce();
  await a.away.pollOnce();
  await a.away.pollOnce();
  expect(a.backs()).toHaveLength(1);
  expect(entry(dir, "/a")).toBeUndefined();
});

test("M8: a handover tells the old owner's Claude; the old project is then cleared", async () => {
  const dir = store();
  const a = server(dir, "/a", { sessions: "one" });
  const b = server(dir, "/b", { sessions: "one" });
  await a.tool("set_away", { on: true });
  await b.tool("set_away", { on: true });
  expect(a.backs()).toHaveLength(0);
  await a.away.pollOnce();
  expect(a.backs()).toHaveLength(1);
  expect(entry(dir, "/a")).toBeUndefined();
});

test("M1: a terminal end whose owner died is finished by another server: recap sent, entry cleared", async () => {
  const dir = store();
  const a = server(dir, "/a");
  const b = server(dir, "/b");
  await a.tool("set_away", { on: true });
  withStore(dir, T, (s) => {
    const p = s.projects[projectKey("/a")]!;
    p.recap.push({ kind: "finished", text: "built it" });
    p.awayUntil = 0; // the hook saw terminal input; server a is gone and never sends the recap
  });
  clock.now = T + 5 * MIN;
  await b.tool("set_away", { on: true });
  await b.away.pollOnce();
  expect(b.fake.sent.join(" | ")).toContain("built it");
  expect(entry(dir, "/a")).toBeUndefined();
});

test("M2: after back in one project, another server polls straight away", async () => {
  const dir = store();
  const a = server(dir, "/a");
  const b = server(dir, "/b");
  await a.tool("set_away", { on: true });
  await b.tool("set_away", { on: true });
  await a.away.pollOnce(); // a holds the lease
  await a.tool("set_away", { on: false });
  const before = b.polls();
  await b.away.pollOnce();
  expect(b.polls()).toBe(before + 1);
});

test("M5: with a long project name, every `more` part still fits one message and nothing is cut", async () => {
  const dir = store();
  const long = `/${"p".repeat(300)}`;
  const a = server(dir, long);
  await a.tool("set_away", { on: true });
  const preview = "echo hello world ".repeat(150).trim();
  withStore(dir, T, (s) => void s.projects[projectKey(long)]!.permissions.push(
    { id: "abcde", tool: "Bash", at: T, preview, needsMore: true, instance: s.projects[projectKey(long)]!.ownerInstance }));
  a.fake.reply("more abcde", T);
  await a.away.pollOnce();
  const parts = a.fake.sent.filter((t) => /\(\d+\/\d+\) /.test(t));
  expect(parts.length).toBeGreaterThan(0);
  for (const t of parts) expect(t.length).toBeLessThanOrEqual(1200);
  expect(parts.map((t) => /\(\d+\/\d+\) ([\s\S]*)$/.exec(t)![1]).join("")).toBe(preview);
});
