import { expect, test } from "bun:test";
import { dispatch } from "../plugin/server/dispatch.ts";
import { projectKey } from "../plugin/server/project.ts";
import { freshProject, freshStore, type Store } from "../plugin/server/store.ts";

const A = projectKey("/a");
const B = projectKey("/b");
const NOW = 1_000;
const perm = (id: string) => ({ id, tool: "Bash", at: 0 });
const q = (id: string) => ({ id, text: "?", options: [] });

function store(only?: string): Store {
  const s: Store = { ...freshStore(), me: "u1" };
  for (const [k, tag] of [[A, "a"], [B, "b"]] as const) if (!only || only === k) s.projects[k] = { ...freshProject(tag), awayUntil: NOW + 1 };
  return s;
}
const msg = (text: string, from = "u1") => ({ id: "m", from, text, at: "2026-01-01T00:00:00Z" });

test("stranger is dropped", () => {
  expect(dispatch(msg("hi", "x"), store(), NOW)).toEqual({ targets: [], action: { kind: "drop" } });
});

test("@tag routes within one project; unknown tag prompts", () => {
  expect(dispatch(msg("@b rerun it"), store(), NOW)).toEqual({ targets: [B], action: { kind: "instruction", text: "rerun it" } });
  const r = dispatch(msg("@zzz hi"), store(), NOW);
  expect(r.targets).toEqual([]);
  expect(r.action).toMatchObject({ kind: "prompt", text: expect.stringContaining("No project called zzz is away. Away now: a, b.") });
});

test("live-ID verdict goes to the owning project", () => {
  const s = store();
  s.projects[B]!.permissions.push(perm("kpqrs"));
  expect(dispatch(msg("yes kpqrs"), s, NOW)).toEqual({ targets: [B], action: { kind: "verdict", id: "kpqrs", behavior: "allow" } });
});

test("@a yes <id owned by b> approves nothing", () => {
  const s = store();
  s.projects[B]!.permissions.push(perm("kpqrs"));
  expect(dispatch(msg("@a yes kpqrs"), s, NOW)).toEqual({ targets: [], action: { kind: "prompt", text: "kpqrs is waiting in b, not a." } });
});

test("bare yes: one permission and no question approves; a question anywhere prompts", () => {
  const s = store();
  s.projects[B]!.permissions.push(perm("kpqrs"));
  expect(dispatch(msg("yes"), s, NOW)).toEqual({ targets: [B], action: { kind: "verdict", id: "kpqrs", behavior: "allow" } });
  s.projects[A]!.questions.push(q("q1"));
  expect(dispatch(msg("yes"), s, NOW).action.kind).toBe("prompt");
});

test("bare yes older than the request prompts (sentAt)", () => {
  const s = store();
  s.projects[B]!.permissions.push({ ...perm("kpqrs"), at: Date.parse("2026-01-02T00:00:00Z") });
  expect(dispatch(msg("yes"), s, NOW).action.kind).toBe("prompt");
  expect(dispatch({ ...msg("yes"), sentAt: "2026-01-03T00:00:00Z" }, s, NOW).action.kind).toBe("verdict");
});

test("#qN goes to the owning project", () => {
  const s = store();
  s.projects[A]!.questions.push(q("q3"));
  expect(dispatch(msg("#q3 no"), s, NOW)).toEqual({ targets: [A], action: { kind: "answer", questionId: "q3", text: "no" } });
});

test("status targets every away project", () => {
  expect(dispatch(msg("status"), store(), NOW)).toEqual({ targets: [A, B], action: { kind: "status" } });
});

test("plain text: one open question answers it, none prompts", () => {
  const s = store();
  expect(dispatch(msg("looks good"), s, NOW)).toEqual({
    targets: [],
    action: { kind: "prompt", text: "Which project? Start with @a or @b." },
  });
  s.projects[A]!.questions.push(q("q1"));
  expect(dispatch(msg("looks good"), s, NOW)).toEqual({ targets: [A], action: { kind: "answer", questionId: "q1", text: "looks good" } });
});

test("only one project away: plain text is an instruction, as in v1.0.1", () => {
  expect(dispatch(msg("rerun"), store(A), NOW)).toEqual({ targets: [A], action: { kind: "instruction", text: "rerun" } });
});

test("untagged extend targets every away project; @tag only that one", () => {
  expect(dispatch(msg("extend 1h"), store(), NOW)).toEqual({ targets: [A, B], action: { kind: "extend", minutes: 60 } });
  expect(dispatch(msg("@a extend 1h"), store(), NOW)).toEqual({ targets: [A], action: { kind: "extend", minutes: 60 } });
});

test("more <id> targets the project holding that request; unknown id prompts", () => {
  const s = store();
  s.projects[B]!.permissions.push(perm("kpqrs"));
  expect(dispatch(msg("more kpqrs"), s, NOW)).toEqual({ targets: [B], action: { kind: "more", id: "kpqrs" } });
  expect(dispatch(msg("more zzzzz"), s, NOW)).toEqual({ targets: [], action: { kind: "prompt", text: "No request zzzzz is waiting." } });
});
