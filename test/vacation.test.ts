// v1.3.0 Task 1: vacation state and the 30-day ceiling.
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
const DAY = 86_400_000;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "away-"));
  withStore(dir, T, (s) => void (s.me = "user-1"));
  const out: Json[] = [];
  const away = createAway({
    adapter: new FakeAdapter("user-1"), dir, key: projectKey("/a"), project: "a", hours: 9, waitMinutes: 60,
    now: () => T, sleep: () => new Promise(() => {}), write: (l) => void out.push(JSON.parse(l)),
  });
  let id = 0;
  const tool = async (name: string, args: Json) => {
    await away.handle(JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }));
    const r = out.at(-1) as any;
    return { text: String(r.result?.content?.[0]?.text ?? r.error?.message ?? "") };
  };
  const entry = () => withStore(dir, T, (s) => s.projects[projectKey("/a")]);
  return { tool, entry };
}

test("set_away vacation for 5 days is on, with vacation state", async () => {
  const { tool, entry } = setup();
  await tool("set_away", { on: true, vacation: true, days: 5 });
  expect(entry()?.awayUntil).toBe(T + 5 * DAY);
  expect(entry()?.vacation).toEqual({ since: T, lastCheckinAt: T, finished: 0 });
});

test("31 days is refused with the 30-day message", async () => {
  const { tool, entry } = setup();
  const r = await tool("set_away", { on: true, vacation: true, days: 31 });
  expect(r.text).toContain("Away mode can last at most 30 days.");
  expect(entry()?.awayUntil ?? 0).toBe(0);
});

test("a plain away with an ISO until 40 days out is refused too", async () => {
  const { tool } = setup();
  const r = await tool("set_away", { on: true, until: new Date(T + 40 * DAY).toISOString() });
  expect(r.text).toContain("Away mode can last at most 30 days.");
});

test("back ends vacation and clears its state", async () => {
  const { tool, entry } = setup();
  await tool("set_away", { on: true, vacation: true, days: 5 });
  await tool("set_away", { on: false });
  expect(entry()?.vacation).toBeUndefined();
  expect(entry()?.awayUntil ?? 0).toBe(0);
});

test("status says On vacation until", async () => {
  const { tool } = setup();
  await tool("set_away", { on: true, vacation: true, days: 5 });
  expect((await tool("status", {})).text).toContain("On vacation until");
});
