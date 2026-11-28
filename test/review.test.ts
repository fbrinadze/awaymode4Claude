// v1.3.0 review fixes. Fake adapter and fake keep-awake only: no real Teams or power calls.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAway, type Deps } from "../plugin/server/away.ts";
import type { KeepAwake } from "../plugin/server/keepawake.ts";
import type { Json } from "../plugin/server/mcp.ts";
import { projectKey } from "../plugin/server/project.ts";
import { withStore } from "../plugin/server/store.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const local = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
class FakeKA implements KeepAwake {
  on = false;
  holds: boolean[] = [];
  hold(display: boolean) { this.on = true; this.holds.push(display); }
  release() { this.on = false; }
  held() { return this.on; }
}
/** A KeepAwake whose hold never takes. */
class FailingKA extends FakeKA {
  override hold(display: boolean) { this.holds.push(display); }
}

function setup(over: Partial<Deps> = {}, shared?: { dir: string; clock: { t: number } }, key = "/a") {
  const dir = shared?.dir ?? mkdtempSync(join(tmpdir(), "away-"));
  const clock = shared?.clock ?? { t: local(26, 18) };
  withStore(dir, clock.t, (s) => void (s.me = "user-1"));
  const out: Json[] = [];
  const adapter = new FakeAdapter("user-1");
  const ka = new FakeKA();
  const away = createAway({
    adapter, dir, key: projectKey(key), project: key.slice(1), hours: 9, waitMinutes: 60, keepAwake: ka, isLaptop: () => false,
    now: () => clock.t, sleep: () => new Promise(() => {}), write: (l) => void out.push(JSON.parse(l)), ...over,
  });
  let id = 0;
  const tool = async (name: string, args: Json) => {
    await away.handle(JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }));
    const r = out.at(-1) as any;
    return String(r.result?.content?.[0]?.text ?? r.error?.message ?? "");
  };
  const entry = (k = key) => withStore(dir, clock.t, (s) => s.projects[projectKey(k)]);
  const patch = (fn: (p: any) => void, k = key) => withStore(dir, clock.t, (s) => fn(s.projects[projectKey(k)]));
  return { tool, entry, patch, adapter, away, dir, clock, ka };
}
const checkins = (a: FakeAdapter) => a.meta.flatMap((m, i) => (m.kind === "checkin" ? [a.sent[i]!] : []));
void checkins; void FailingKA;

const TZ = process.env.TZ;
afterEach(() => { if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

test("set_away at a weekday uses vacation_return_time", async () => {
  const x = setup({ returnTime: "18:00" });
  await x.tool("set_away", { on: true, vacation: true, at: "monday" });
  const d = new Date(x.entry()!.awayUntil);
  expect([d.getDay(), d.getHours(), d.getMinutes()]).toEqual([1, 18, 0]);
});

test("a garbage vacation_return_time falls back to 9:00 and never throws", async () => {
  const x = setup({ returnTime: "25:00" });
  const r = await x.tool("set_away", { on: true, vacation: true, at: "monday" });
  expect(r).toContain("Away mode on");
  const d = new Date(x.entry()!.awayUntil);
  expect([d.getDay(), d.getHours()]).toEqual([1, 9]);
});

test("days is local-calendar arithmetic across a DST change", async () => {
  process.env.TZ = "America/New_York"; // DST ended 2026-11-01
  const x = setup();
  x.clock.t = new Date(2026, 9, 30, 12).getTime();
  await x.tool("set_away", { on: true, vacation: true, days: 5 });
  const d = new Date(x.entry()!.awayUntil);
  expect([d.getMonth(), d.getDate(), d.getHours()]).toEqual([10, 4, 12]);
});

/** pollOnce, returning the error a failed send raises instead of throwing it (the real loop logs it). */
const poll = async (x: { away: { pollOnce(): Promise<number> } }): Promise<unknown> => {
  try { await x.away.pollOnce(); return null; } catch (e) { return e; }
};

test("a check-in lists only approvals still inside wait_minutes", async () => {
  const x = setup();
  await x.tool("set_away", { on: true, vacation: true, days: 5 });
  const at = local(26, 20);
  x.clock.t = local(27, 9, 1);
  x.patch((p) => {
    p.permissions.push({ id: "abcde", tool: "OLDTOOL", at, description: "", input: "" });
    p.permissions.push({ id: "fghij", tool: "NEWTOOL", at: x.clock.t - 60_000, description: "", input: "" });
  });
  await x.away.pollOnce();
  const text = checkins(x.adapter)[0]!;
  expect(text).toContain("NEWTOOL");
  expect(text).not.toContain("OLDTOOL");
});

test("a failed check-in send is not lost: it retries and finished is kept", async () => {
  const x = setup();
  await x.tool("set_away", { on: true, vacation: true, days: 5 });
  await x.tool("notify", { type: "finished", text: "built it" });
  x.clock.t = local(27, 9, 1);
  x.adapter.failSends = true;
  expect(await poll(x)).not.toBeNull();
  expect(x.entry()?.vacation?.finished).toBe(1);
  expect(x.entry()?.vacation?.lastCheckinAt).toBeLessThan(local(27, 9));
  x.adapter.failSends = false;
  await x.away.pollOnce();
  expect(checkins(x.adapter)).toHaveLength(1);
  expect(checkins(x.adapter)[0]).toContain("1 finished");
});

test("keep-awake still ticks when the check-in send fails", async () => {
  const x = setup();
  await x.tool("set_away", { on: true, vacation: true, days: 5 });
  x.ka.release(); // the inbox loop already ticked once at set_away; start from not held
  x.clock.t = local(27, 9, 1);
  x.adapter.failSends = true;
  await poll(x);
  expect(x.ka.held()).toBe(true);
});
