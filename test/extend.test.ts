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

test("until a clock time that already passed today resolves to tomorrow", async () => {
  const e = env(T + 3_600_000);
  const past = new Date(T - 3_600_000);
  await e.act({ kind: "extend", at: `${past.getHours()}:${String(past.getMinutes()).padStart(2, "0")}` });
  const tomorrow = new Date(T);
  tomorrow.setDate(tomorrow.getDate() + 1);
  expect(new Date(e.st.awayUntil).getDate()).toBe(tomorrow.getDate());
  expect(e.said.at(-1)).toContain("for order-portal.");
});

test("extending a project that is no longer away changes nothing", async () => {
  const e = env(0);
  await e.act({ kind: "extend", minutes: 30 });
  expect(e.st.awayUntil).toBe(0);
  expect(e.said.at(-1)).toBe("Away mode already ended for order-portal.");
});
