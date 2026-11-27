import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { makeAct } from "../plugin/server/deliver.ts";
import { fresh } from "../plugin/server/state.ts";

const T = Date.parse("2026-11-26T18:00:00Z");

function env(awayUntil: number) {
  const st = { ...fresh(), awayUntil };
  const said: string[] = [];
  const act = makeAct({
    dir: mkdtempSync(join(tmpdir(), "away-ext-")), key: "/x/order-portal", instance: "i1", hours: 9,
    now: () => T, current: () => st, update: (fn) => (fn(st), st), say: async (t) => void said.push(t),
    notify: () => {}, channel: () => {}, answer: async () => {}, end: () => "",
  });
  return { st, said, act };
}

test("extend 30m adds exactly 30 minutes and replies with the new end", async () => {
  const e = env(T + 3_600_000);
  await e.act({ kind: "extend", minutes: 30 });
  expect(e.st.awayUntil).toBe(T + 5_400_000);
  expect(e.said.at(-1)).toBe(`Away until ${new Date(T + 5_400_000).toString()} for order-portal.`);
});

// Local-time clocks, so the tests hold in any timezone.
const at = (h: number, m = 0) => new Date(2026, 10, 26, h, m).getTime();

function envAt(now: number) {
  const st = { ...fresh(), awayUntil: now + 3_600_000 };
  const said: string[] = [];
  const act = makeAct({
    dir: mkdtempSync(join(tmpdir(), "away-ext-")), key: "/x/order-portal", instance: "i1", hours: 9,
    now: () => now, current: () => st, update: (fn) => (fn(st), st), say: async (t) => void said.push(t),
    notify: () => {}, channel: () => {}, answer: async () => {}, end: () => "",
  });
  return { st, said, act, before: st.awayUntil };
}

test("until a clock time that already passed today changes nothing and says so", async () => {
  const e = envAt(at(19));
  await e.act({ kind: "extend", at: "6pm" });
  expect(e.st.awayUntil).toBe(e.before);
  expect(e.said.at(-1)).toBe("6pm has already passed today. Try extend 30m or until a later time.");
});

test("a bare hour that is next reached tomorrow is refused too", async () => {
  const e = envAt(at(19));
  await e.act({ kind: "extend", at: "6" });
  expect(e.st.awayUntil).toBe(e.before);
  expect(e.said.at(-1)).toContain("has already passed today");
});

test("a bare hour means its next occurrence within 12 hours: until 6 at 2pm is 6pm", async () => {
  const e = envAt(at(14));
  await e.act({ kind: "extend", at: "6" });
  expect(e.st.awayUntil).toBe(at(18));
});

test("a normal until 6pm at 2pm still works", async () => {
  const e = envAt(at(14));
  await e.act({ kind: "extend", at: "6pm" });
  expect(e.st.awayUntil).toBe(at(18));
});

test("extending a project that is no longer away changes nothing", async () => {
  const e = env(0);
  await e.act({ kind: "extend", minutes: 30 });
  expect(e.st.awayUntil).toBe(0);
  expect(e.said.at(-1)).toBe("Away mode already ended for order-portal.");
});
