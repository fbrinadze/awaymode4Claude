import { expect, test } from "bun:test";
import { clock } from "../plugin/server/when.ts";

const now = new Date(2026, 10, 27, 18, 0).getTime(); // local 6:00 PM, Friday

test("today: just the time, like 6:30 PM", () => {
  expect(clock(new Date(2026, 10, 27, 18, 30).getTime(), now)).toBe("6:30 PM");
});

test("another day: weekday and time", () => {
  expect(clock(new Date(2026, 10, 28, 9, 0).getTime(), now)).toBe("Sat 9:00 AM");
});
