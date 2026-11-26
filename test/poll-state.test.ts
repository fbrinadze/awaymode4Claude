import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextDelay, pollLoop } from "../plugin/server/poll.ts";
import { fresh, isAway, load, save } from "../plugin/server/state.ts";

test("backoff: 5 s after a message, doubling to a 60 s cap", () => {
  const seq: number[] = [];
  let d = 5_000;
  for (let i = 0; i < 5; i++) seq.push((d = nextDelay(d, false)));
  expect(seq).toEqual([10_000, 20_000, 40_000, 60_000, 60_000]);
  expect(nextDelay(60_000, true)).toBe(5_000);
});

test("pollLoop polls only while away and survives a failed poll", async () => {
  const quiet = spyOn(console, "error").mockImplementation(() => {});
  const results = [1, new Error("network"), 0];
  const sleeps: number[] = [];
  let polls = 0;
  await pollLoop({
    away: () => polls < 3,
    fetch: async () => {
      const r = results[polls++];
      if (r instanceof Error) throw r;
      return r ?? 0;
    },
    sleep: async (ms) => void sleeps.push(ms),
  });
  expect(polls).toBe(3);
  expect(sleeps).toEqual([5_000, 10_000, 20_000]);
  expect(quiet).toHaveBeenCalledTimes(1);
  quiet.mockRestore();
});

test("state round-trips, and missing or corrupt files load fresh", () => {
  const dir = mkdtempSync(join(tmpdir(), "away-"));
  expect(load(dir)).toEqual(fresh());
  const s = { ...fresh(), me: "u1", awayUntil: 5, questions: [{ id: "q1", text: "?", options: [] }] };
  save(dir, s);
  expect(load(dir)).toEqual(s);
  writeFileSync(join(dir, "state.json"), "{oops");
  expect(load(dir)).toEqual(fresh());
});

test("isAway compares against now", () => {
  expect(isAway({ ...fresh(), awayUntil: 10 }, 9)).toBe(true);
  expect(isAway({ ...fresh(), awayUntil: 10 }, 10)).toBe(false);
});
