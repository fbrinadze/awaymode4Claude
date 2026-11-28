import { expect, test } from "bun:test";
import { checkinText, dueCheckin, parseCheckins } from "../plugin/server/checkin.ts";
import { freshProject } from "../plugin/server/store.ts";

const at = (d: number, h: number, m = 0) => new Date(2026, 5, d, h, m).getTime();
const nine = [{ h: 9, m: 0 }];

test("9:00 default", () => {
  expect(parseCheckins(undefined)).toEqual(nine);
  expect(parseCheckins("")).toEqual(nine);
});
test("garbage falls back to 9:00", () => {
  expect(parseCheckins("25:00, x, ")).toEqual(nine);
});
test("unordered times are sorted", () => {
  expect(parseCheckins("18:00, 8, 9:30pm")).toEqual([{ h: 8, m: 0 }, { h: 18, m: 0 }, { h: 21, m: 30 }]);
});
test("0:30 just after midnight is due once", () => {
  const t = [{ h: 0, m: 30 }];
  expect(dueCheckin(t, at(10, 12), at(11, 0, 45))).toBe(at(11, 0, 30));
  expect(dueCheckin(t, at(11, 0, 30), at(11, 0, 45))).toBeNull();
});
test("several missed times give one due time", () => {
  const t = parseCheckins("8:00, 18:00");
  expect(dueCheckin(t, at(10, 19), at(13, 20))).toBe(at(13, 18));
});
test("nothing due before the first time", () => {
  expect(dueCheckin(nine, at(10, 9), at(11, 8, 59))).toBeNull();
});
test("checkinText lists approvals with ids and reply line", () => {
  const now = at(10, 12);
  const p = freshProject("t");
  Object.assign(p, {
    awayUntil: at(12, 9),
    vacation: { since: at(9, 9), lastCheckinAt: 0, finished: 2 },
    permissions: [{ id: "abcde", tool: "Bash", at: now - 3 * 3_600_000 }],
    questions: [{ id: "q1", text: "Which db?", options: [], askedAt: now - 3_600_000 }],
    recap: [{ kind: "parked", text: "rename the table" }],
  });
  const t = checkinText(p, now);
  expect(t).toContain("On vacation until Fri 9:00 AM");
  expect(t).toContain("2 finished since the last check-in (sent as they happened)");
  expect(t).toContain("- Bash abcde (waiting 3h): reply yes abcde or no abcde");
  expect(t).toContain("- q1: Which db? (waiting 1h)");
  expect(t).toContain("Parked:\n- rename the table");
  expect(t).toContain("Reply with what to do and it goes to Claude.");
});
test("idle text", () => {
  const p = freshProject("t");
  p.awayUntil = at(12, 9);
  expect(checkinText(p, at(10, 12)).split("\n")).toEqual(["On vacation until Fri 9:00 AM", "Still working. Nothing needs you."]);
});
