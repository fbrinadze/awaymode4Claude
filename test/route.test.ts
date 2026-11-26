import { expect, test } from "bun:test";
import { route } from "../plugin/server/route.ts";
import { fresh, type State } from "../plugin/server/state.ts";

const perm = (id: string) => ({ id, tool: "Bash", at: 0 });
const q = (id: string, options: string[] = []) => ({ id, text: "?", options });

function state(over: Partial<State> = {}): State {
  return { ...fresh(), me: "u1", ...over };
}
const msg = (text: string, from = "u1") => ({ id: "m", from, text, at: "" });

test("sender gate: only the paired account gets through", () => {
  const s = state({ permissions: [perm("abcde")] });
  expect(route(msg("yes abcde", "intruder"), s)).toEqual({ kind: "drop" });
  expect(route(msg("yes abcde"), { ...s, me: "" })).toEqual({ kind: "drop" });
  expect(route(msg("   "), s)).toEqual({ kind: "drop" });
});

test("yes/no with a live ID is a verdict, any case", () => {
  const s = state({ permissions: [perm("abcde"), perm("fghij")] });
  expect(route(msg("yes abcde"), s)).toEqual({ kind: "verdict", id: "abcde", behavior: "allow" });
  expect(route(msg("NO FGHIJ"), s)).toEqual({ kind: "verdict", id: "fghij", behavior: "deny" });
  expect(route(msg("y abcde"), s)).toEqual({ kind: "verdict", id: "abcde", behavior: "allow" });
});

test("bare yes/no only counts when exactly one action is waiting", () => {
  expect(route(msg("yes"), state({ permissions: [perm("abcde")] }))).toEqual({
    kind: "verdict",
    id: "abcde",
    behavior: "allow",
  });
  const two = route(msg("yes"), state({ permissions: [perm("abcde"), perm("fghij")] }));
  expect(two.kind).not.toBe("verdict");
  expect(route(msg("no"), state()).kind).toBe("instruction");
});

test("an unknown or malformed ID is never an approval", () => {
  const s = state({ permissions: [perm("abcde")] });
  expect(route(msg("yes zzzzz"), s).kind).not.toBe("verdict");
  expect(route(msg("yes abcle"), s).kind).not.toBe("verdict"); // "l" is never in an ID
  expect(route(msg("yes abcde please"), s).kind).not.toBe("verdict");
});

test("a verdict wins over an open question", () => {
  const s = state({ permissions: [perm("abcde")], questions: [q("q1", ["yes", "no"])] });
  expect(route(msg("yes"), s)).toEqual({ kind: "verdict", id: "abcde", behavior: "allow" });
});

test("text answers the newest open question", () => {
  const s = state({ questions: [q("q1"), q("q2")] });
  expect(route(msg("2"), s)).toEqual({ kind: "answer", questionId: "q2", text: "2" });
});

test("#qN answers an older question", () => {
  const s = state({ questions: [q("q1"), q("q2")] });
  expect(route(msg("#q1 use last month"), s)).toEqual({ kind: "answer", questionId: "q1", text: "use last month" });
  expect(route(msg("#Q1 x"), s)).toEqual({ kind: "answer", questionId: "q1", text: "x" });
});

test("#qN for a closed question doesn't answer it", () => {
  expect(route(msg("#q9 x"), state())).toEqual({ kind: "instruction", text: "#q9 x" });
});

test("status and back are commands when nothing is open", () => {
  expect(route(msg("status"), state())).toEqual({ kind: "status" });
  expect(route(msg("BACK"), state())).toEqual({ kind: "back" });
});

test("back still ends away mode with a question open; #qN answers it literally", () => {
  const s = state({ questions: [q("q1")] });
  expect(route(msg("back"), s)).toEqual({ kind: "back" });
  expect(route(msg("#q1 back"), s)).toEqual({ kind: "answer", questionId: "q1", text: "back" });
});

test("anything else with nothing open is a new instruction", () => {
  expect(route(msg("also update the README"), state())).toEqual({
    kind: "instruction",
    text: "also update the README",
  });
});
