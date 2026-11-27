import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAway } from "../plugin/server/away.ts";
import { makeAct } from "../plugin/server/deliver.ts";
import { fresh } from "../plugin/server/state.ts";
import { LEASE_MS } from "../plugin/server/lease.ts";
import type { Json } from "../plugin/server/mcp.ts";
import { withStore } from "../plugin/server/store.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const T = Date.parse("2026-11-26T18:00:00Z");
const KEY = "proj";

function pair() {
  const dir = mkdtempSync(join(tmpdir(), "away-"));
  withStore(dir, T, (s) => void (s.me = "user-1"));
  const clock = { t: T };
  const mk = (instance: string) => {
    const fake = new FakeAdapter("user-1");
    const out: Json[] = [];
    const sleeps: { ms: number; go(): void }[] = [];
    const away = createAway({
      adapter: fake, dir, key: KEY, instance, project: "p", hours: 9, waitMinutes: 60, now: () => clock.t,
      sleep: (ms) => new Promise<void>((go) => sleeps.push({ ms, go })), write: (l) => void out.push(JSON.parse(l)),
    });
    const call = (name: string, args: Json) =>
      away.handle(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }));
    const channel = () => out.filter((m) => m.method === "notifications/claude/channel").map((m) => (m.params as Json).content);
    const verdicts = () => out.filter((m) => m.method === "notifications/claude/channel/permission");
    return { fake, away, call, channel, verdicts, sleeps };
  };
  const owner = () => withStore(dir, clock.t, (s) => s.projects[KEY]?.ownerInstance);
  const queue = (text: string) =>
    withStore(dir, clock.t, (s) => void s.projects[KEY]!.inbox.push({ action: { kind: "instruction", text }, at: "x" }));
  return { dir, clock, mk, owner, queue };
}
const request = (a: ReturnType<ReturnType<typeof pair>["mk"]>) =>
  a.away.handle(JSON.stringify({
    jsonrpc: "2.0", method: "notifications/claude/channel/permission_request",
    params: { request_id: "abcde", tool_name: "Bash", description: "d", input_preview: "ls" },
  }));

test("only the owner instance delivers an inbox instruction", async () => {
  const h = pair();
  const i2 = h.mk("I2");
  const i1 = h.mk("I1");
  await i2.call("set_away", { on: true });
  await i1.call("set_away", { on: true });
  expect(h.owner()).toBe("I1");
  h.queue("do it");
  await i2.away.pollOnce();
  expect(i2.channel()).toEqual([]);
  await i1.away.pollOnce();
  expect(i1.channel()).toEqual(["do it"]);
});

test("a verdict for a permission raised by another instance is not delivered", async () => {
  const h = pair();
  const i2 = h.mk("I2");
  const i1 = h.mk("I1");
  await i2.call("set_away", { on: true });
  await i1.call("set_away", { on: true });
  await request(i2);
  i1.fake.reply("yes abcde", h.clock.t);
  await i1.away.pollOnce();
  expect(i1.verdicts()).toEqual([]);
  expect(i1.fake.sent.at(-1)).toContain("That request is no longer waiting.");
});

test("a verdict for this instance's own permission is delivered", async () => {
  const h = pair();
  const i1 = h.mk("I1");
  await i1.call("set_away", { on: true });
  await request(i1);
  i1.fake.reply("yes abcde", h.clock.t);
  await i1.away.pollOnce();
  expect(i1.verdicts().length).toBe(1);
});

test("a stale owner is adopted, permissions included", async () => {
  const h = pair();
  const i2 = h.mk("I2");
  const i1 = h.mk("I1");
  await i2.call("set_away", { on: true });
  await i1.call("set_away", { on: true });
  await request(i2);
  h.clock.t += LEASE_MS + 1;
  h.queue("late");
  await i2.away.pollOnce();
  expect(h.owner()).toBe("I2");
  expect(i2.channel()).toEqual(["late"]);
  i2.fake.reply("yes abcde", h.clock.t);
  await i2.away.pollOnce();
  expect(i2.verdicts().length).toBe(1);
});

test("a live owner is not adopted", async () => {
  const h = pair();
  const i2 = h.mk("I2");
  const i1 = h.mk("I1");
  await i2.call("set_away", { on: true });
  await i1.call("set_away", { on: true });
  h.clock.t += LEASE_MS - 1;
  await i2.away.pollOnce();
  expect(h.owner()).toBe("I1");
});

test("the inbox drains on its own 5 s timer while the Graph poll is backed off", async () => {
  const h = pair();
  const i1 = h.mk("I1");
  await i1.call("set_away", { on: true });
  await new Promise((r) => setTimeout(r, 20));
  expect(i1.sleeps.some((s) => s.ms > 5_000)).toBe(true); // poll backed off
  h.queue("now");
  const tick = i1.sleeps.find((s) => s.ms === 5_000)!;
  expect(tick).toBeDefined();
  tick.go();
  await new Promise((r) => setTimeout(r, 20));
  expect(i1.channel()).toEqual(["now"]);
});

const expiredPermission = (h: ReturnType<typeof pair>, extra = {}) =>
  withStore(h.dir, h.clock.t, (s) => void s.projects[KEY]!.permissions.push({ id: "abcde", tool: "Bash", at: h.clock.t, instance: "I1", needsMore: true, ...extra }));

test("an id older than wait_minutes is not approved by yes <id>", async () => {
  const h = pair();
  const i1 = h.mk("I1");
  await i1.call("set_away", { on: true });
  expiredPermission(h);
  h.clock.t += 61 * 60_000;
  i1.fake.reply("yes abcde", h.clock.t);
  await i1.away.pollOnce();
  expect(i1.verdicts()).toEqual([]);
});

test("a bare yes with one expired permission is not approved", async () => {
  const h = pair();
  const i1 = h.mk("I1");
  await i1.call("set_away", { on: true });
  expiredPermission(h, { needsMore: false });
  h.clock.t += 61 * 60_000;
  i1.fake.reply("yes", h.clock.t);
  await i1.away.pollOnce();
  expect(i1.verdicts()).toEqual([]);
});

test("a verdict for an id that is no longer pending says so and notifies nothing", async () => {
  const said: string[] = [];
  const notes: string[] = [];
  const act = makeAct({
    dir: "", key: KEY, instance: "I1", now: () => T, hours: 9, current: () => ({ ...fresh(), permissions: [] }),
    update: () => fresh(), say: async (t) => void said.push(t), notify: (m) => void notes.push(m),
    channel: () => {}, answer: async () => {}, end: () => "",
  });
  await act({ kind: "verdict", id: "abcde", behavior: "allow" });
  expect(notes).toEqual([]);
  expect(said).toEqual(["That request is no longer waiting."]);
});
