import { expect, test } from "bun:test";
import { parseCommand } from "../plugin/server/commands.ts";

test("parses commands case-insensitively", () => {
  expect(parseCommand("Extend 1h")).toEqual({ kind: "extend", minutes: 60 });
  expect(parseCommand("extend 30 min")).toEqual({ kind: "extend", minutes: 30 });
  expect(parseCommand("extend 2 hours")).toEqual({ kind: "extend", minutes: 120 });
  expect(parseCommand("until 6pm")).toEqual({ kind: "extend", at: "6pm" });
  expect(parseCommand("until 18:30")).toEqual({ kind: "extend", at: "18:30" });
  expect(parseCommand("snooze 30m")).toEqual({ kind: "snooze", minutes: 30 });
  expect(parseCommand("snooze until 3pm")).toEqual({ kind: "snooze", at: "3pm" });
  expect(parseCommand("UNSNOOZE")).toEqual({ kind: "unsnooze" });
  expect(parseCommand("more kpqrs")).toEqual({ kind: "more", id: "kpqrs" });
  expect(parseCommand("Status")).toEqual({ kind: "status" });
  expect(parseCommand("back")).toEqual({ kind: "back" });
});

test("anything else falls through to text", () => {
  for (const t of ["extend soon", "more", "more abcle", "snooze forever", "extend 1h please", "until", "status now"])
    expect(parseCommand(t)).toBeNull();
});

test("extend 2d parses to 2880 minutes", () => {
  expect(parseCommand("extend 2d")).toEqual({ kind: "extend", minutes: 2880 });
  expect(parseCommand("extend 2 days")).toEqual({ kind: "extend", minutes: 2880 });
  expect(parseCommand("extend 1day")).toEqual({ kind: "extend", minutes: 1440 });
});

test("until monday parses to at monday", () => {
  expect(parseCommand("until monday")).toEqual({ kind: "extend", at: "monday" });
  expect(parseCommand("Until Fri")).toEqual({ kind: "extend", at: "fri" });
});
