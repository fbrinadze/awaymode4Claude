import { expect, test } from "bun:test";
import { resolveUntil } from "../plugin/server/when.ts";

// Local-time dates, so the tests hold in any timezone. 2026-11-23 is a Monday.
const local = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m).getTime();

test("monday resolves to next Monday at 9:00, never today", () => {
  const now = local(23, 8);
  for (const at of ["monday", "Mon", "MONDAY"]) expect(resolveUntil({ at }, now, 9)).toBe(local(30, 9));
});

test("fri at returnTime 18:00", () => {
  expect(resolveUntil({ at: "fri" }, local(23, 8), 9, "18:00")).toBe(local(27, 18));
});
