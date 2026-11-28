// v1.3.0 Task 6: keep the PC awake on vacation (fake KeepAwake, no real processes).
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide } from "../plugin/hooks/hook.ts";
import { createAway } from "../plugin/server/away.ts";
import type { KeepAwake } from "../plugin/server/keepawake.ts";
import type { Json } from "../plugin/server/mcp.ts";
import { projectKey } from "../plugin/server/project.ts";
import { withStore } from "../plugin/server/store.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const T = Date.parse("2026-11-26T18:00:00Z");
const DAY = 86_400_000;
const NOTE = "On a laptop: keep the lid open";

class FakeKA implements KeepAwake {
  on = false;
  hold() { this.on = true; }
  release() { this.on = false; }
  held() { return this.on; }
}

function setup(laptop = false, dir = mkdtempSync(join(tmpdir(), "away-")), clock = { t: T }, key = "/a", sessions?: "one") {
  withStore(dir, T, (s) => void (s.me = "user-1"));
  const out: Json[] = [];
  const adapter = new FakeAdapter("user-1");
  const ka = new FakeKA();
  const away = createAway({
    adapter, dir, key: projectKey(key), project: key.slice(1), hours: 9, waitMinutes: 60, keepAwake: ka, isLaptop: () => laptop, sessions,
    now: () => clock.t, sleep: () => new Promise(() => {}), write: (l) => void out.push(JSON.parse(l)),
  });
  let id = 0;
  const tool = (name: string, args: Json) =>
    away.handle(JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }));
  const tick = async () => void (await away.pollOnce());
  const patch = (fn: (p: any) => void, k = key) => withStore(dir, clock.t, (s) => fn(s.projects[projectKey(k)]));
  return { tool, tick, ka, adapter, patch, dir, clock };
}
type S = ReturnType<typeof setup>;
const vac = (s: S) => s.tool("set_away", { on: true, vacation: true, days: 5 });

test("held while on vacation", async () => {
  const s = setup();
  await vac(s); await s.tick();
  expect(s.ka.held()).toBe(true);
});

test("released on back", async () => {
  const s = setup();
  await vac(s); await s.tick();
  await s.tool("set_away", { on: false }); await s.tick();
  expect(s.ka.held()).toBe(false);
});

test("released on expiry", async () => {
  const s = setup();
  await vac(s); await s.tick();
  s.clock.t = T + 6 * DAY; await s.tick();
  expect(s.ka.held()).toBe(false);
});

test("released on terminal input", async () => {
  const s = setup();
  await vac(s); await s.tick();
  // The patch the UserPromptSubmit hook itself decides on for terminal input.
  s.patch((p) => Object.assign(p, decide({ hook_event_name: "UserPromptSubmit", prompt: "I'm back" }, p, s.clock.t).patch));
  await s.tick();
  expect(s.ka.held()).toBe(false);
});

test("two real servers: each holds for its own vacation, the PC stays held until the last ends", async () => {
  const dir = mkdtempSync(join(tmpdir(), "away-")), clock = { t: T };
  const a = setup(false, dir, clock, "/a"), b = setup(false, dir, clock, "/b");
  await vac(a); await vac(b);
  await a.tick(); await b.tick();
  expect([a.ka.held(), b.ka.held()]).toEqual([true, true]);
  a.patch((p) => { p.awayUntil = 0; });
  await a.tick(); await b.tick();
  expect([a.ka.held(), b.ka.held()]).toEqual([false, true]);
  b.patch((p) => { p.awayUntil = 0; }, "/b");
  await a.tick(); await b.tick();
  expect([a.ka.held(), b.ka.held()]).toEqual([false, false]);
});

test("released on handover", async () => {
  const dir = mkdtempSync(join(tmpdir(), "away-")), clock = { t: T };
  const a = setup(false, dir, clock, "/a", "one"), b = setup(false, dir, clock, "/b", "one");
  await vac(a); await a.tick();
  expect(a.ka.held()).toBe(true);
  await b.tool("set_away", { on: true, minutes: 60 }); // plain away in /b takes over from /a
  await a.tick();
  expect(a.ka.held()).toBe(false);
  expect(b.ka.held()).toBe(false);
});

test("two projects: released only when the last vacation ends", async () => {
  const dir = mkdtempSync(join(tmpdir(), "away-")), clock = { t: T };
  const a = setup(false, dir, clock, "/a"), b = setup(false, dir, clock, "/b");
  await vac(a); await vac(b);
  // one instance owns both (a restart or adoption): hand /b to /a's instance
  const owner = withStore(dir, T, (s) => s.projects[projectKey("/a")]?.ownerInstance);
  b.patch((p) => { p.ownerInstance = owner; }, "/b");
  await a.tick();
  expect(a.ka.held()).toBe(true);
  a.patch((p) => { p.awayUntil = 0; });
  await a.tick();
  expect(a.ka.held()).toBe(true);
  b.patch((p) => { p.awayUntil = 0; }, "/b");
  await a.tick();
  expect(a.ka.held()).toBe(false);
});

test("plain away never holds", async () => {
  const s = setup();
  await s.tool("set_away", { on: true, minutes: 60 }); await s.tick();
  expect(s.ka.held()).toBe(false);
});

test("laptop note sent once", async () => {
  const s = setup(true);
  await vac(s); await s.tick(); await s.tick();
  expect(s.adapter.sent.filter((m) => m.includes(NOTE))).toHaveLength(1);
  const d = setup(false);
  await vac(d); await d.tick();
  expect(d.adapter.sent.filter((m) => m.includes(NOTE))).toHaveLength(0);
});
