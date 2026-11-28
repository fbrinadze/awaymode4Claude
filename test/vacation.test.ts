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

function setup(shared?: { dir: string; now: { t: number } }) {
  const dir = shared?.dir ?? mkdtempSync(join(tmpdir(), "away-"));
  const clock = shared?.now ?? { t: T };
  withStore(dir, T, (s) => void (s.me = "user-1"));
  const out: Json[] = [];
  const adapter = new FakeAdapter("user-1");
  const away = createAway({
    adapter, dir, key: projectKey("/a"), project: "a", hours: 9, waitMinutes: 60,
    now: () => clock.t, sleep: () => new Promise(() => {}), write: (l) => void out.push(JSON.parse(l)),
  });
  let id = 0;
  const tool = async (name: string, args: Json) => {
    await away.handle(JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }));
    const r = out.at(-1) as any;
    return { text: String(r.result?.content?.[0]?.text ?? r.error?.message ?? "") };
  };
  const entry = () => withStore(dir, clock.t, (s) => s.projects[projectKey("/a")]);
  return { tool, entry, adapter, away, dir, clock };
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

// Task 5: check-ins.
const local = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const checkins = (a: FakeAdapter) => a.meta.flatMap((m, i) => (m.kind === "checkin" ? [a.sent[i]!] : []));

async function vacationFrom(start: number) {
  const x = setup();
  x.clock.t = start;
  await x.tool("set_away", { on: true, vacation: true, days: 5 });
  return x;
}

test("a check-in is sent once at 9:00", async () => {
  const x = await vacationFrom(local(26, 18));
  await x.away.pollOnce();
  expect(checkins(x.adapter)).toHaveLength(0);
  x.clock.t = local(27, 9, 1);
  await x.away.pollOnce();
  await x.away.pollOnce();
  expect(checkins(x.adapter)).toHaveLength(1);
  expect(checkins(x.adapter)[0]).toContain("Still working. Nothing needs you.");
});

test("a second server does not send the same check-in", async () => {
  const x = await vacationFrom(local(26, 18));
  const y = setup({ dir: x.dir, now: x.clock });
  x.clock.t = local(27, 9, 1);
  await y.away.pollOnce();
  await x.away.pollOnce();
  expect(checkins(y.adapter)).toHaveLength(0);
  expect(checkins(x.adapter)).toHaveLength(1);
});

test("after a long sleep exactly one catch-up", async () => {
  const x = await vacationFrom(local(26, 18));
  x.clock.t = local(29, 20);
  await x.away.pollOnce();
  await x.away.pollOnce();
  expect(checkins(x.adapter)).toHaveLength(1);
});

test("a finished note on vacation is counted and shown", async () => {
  const x = await vacationFrom(local(26, 18));
  await x.tool("notify", { type: "finished", text: "built it" });
  expect(x.adapter.sent.some((t) => t.includes("built it"))).toBe(true);
  expect(x.entry()?.vacation?.finished).toBe(1);
  x.clock.t = local(27, 9, 1);
  await x.away.pollOnce();
  expect(checkins(x.adapter)[0]).toContain("1 finished since the last check-in");
  expect(x.entry()?.vacation?.finished).toBe(0);
});
