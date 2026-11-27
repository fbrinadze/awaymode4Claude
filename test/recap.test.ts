import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAway } from "../plugin/server/away.ts";
import { dispatch } from "../plugin/server/dispatch.ts";
import type { Json } from "../plugin/server/mcp.ts";
import { endAway, startAway } from "../plugin/server/recap.ts";
import { freshProject, freshStore, withStore, type ProjectState } from "../plugin/server/store.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const T = Date.parse("2026-11-26T18:00:00Z");
const MIN = 60_000;

function busy(): ProjectState {
  const p = freshProject("a");
  Object.assign(p, { awayUntil: T + MIN, ownerInstance: "i1", sessionId: "sess" });
  p.permissions.push({ id: "abcde", tool: "Bash", at: T });
  p.questions.push({ id: "q1", text: "Archived too?", options: [] });
  p.inbox.push({ action: { kind: "drop" }, at: "x" });
  p.recap.push({ kind: "finished", text: "Exported reports" }, { kind: "info", text: "FYI" }, { kind: "parked", text: "Needs a password" });
  return p;
}

test("recap text: sections only when non-empty, in order", () => {
  expect(endAway(busy(), "back")).toBe(
    "Away ended (back).\nFinished:\n- Exported reports\n- FYI\nStill waiting (cancelled):\n- Bash abcde\nUnanswered:\n- q1: Archived too?\nParked:\n- Needs a password",
  );
  const p = freshProject("a");
  p.recap.push({ kind: "parked", text: "x" });
  expect(endAway(p, "expired")).toBe("Away ended (expired).\nParked:\n- x");
  expect(endAway(freshProject("a"), "off")).toBe("Away ended (off).");
});

test("the terminal variant starts with 'You're back at the terminal.'", () => {
  expect(endAway(busy(), "terminal").startsWith("You're back at the terminal.\n")).toBe(true);
});

test("R2/R3: endAway clears pending state, session and owner", () => {
  const p = busy();
  endAway(p, "off");
  expect(p).toMatchObject({ awayUntil: 0, permissions: [], questions: [], inbox: [], recap: [], ownerInstance: undefined, sessionId: undefined });
});

test("R3: startAway with nothing else away sets the cursor to now, so older messages are not returned", async () => {
  const s = freshStore();
  s.projects.a = busy();
  endAway(s.projects.a, "off");
  startAway(s, "a", T + 5 * MIN, T, "i2");
  expect(s.cursor).toBe(new Date(T).toISOString());
  expect(s.projects.a).toMatchObject({ awayUntil: T + 5 * MIN, awayStartedAt: T, ownerInstance: "i2", ownerSeen: T, permissions: [], questions: [] });
  const fake = new FakeAdapter();
  fake.reply("old", T - 1000);
  expect(await fake.poll(s.cursor)).toEqual([]);
});

test("R3: startAway while another project is away leaves the cursor alone", () => {
  const s = freshStore();
  s.cursor = "2026-11-26T17:00:00.000Z";
  s.projects.b = { ...freshProject("b"), awayUntil: T + MIN };
  s.projects.a = freshProject("a");
  startAway(s, "a", T + 5 * MIN, T, "i2");
  expect(s.cursor).toBe("2026-11-26T17:00:00.000Z");
});

function server() {
  const dir = mkdtempSync(join(tmpdir(), "away-"));
  withStore(dir, T, (s) => void (s.me = "user-1"));
  const fake = new FakeAdapter("user-1");
  const out: Json[] = [];
  let now = T;
  const away = createAway({
    adapter: fake, dir, project: "proj", hours: 9, waitMinutes: 600, now: () => now,
    sleep: () => new Promise(() => {}), write: (l) => void out.push(JSON.parse(l)),
  });
  let id = 0;
  const tool = (name: string, args: Json) =>
    away.handle(JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }));
  return { dir, fake, away, tool, setNow: (n: number) => void (now = n) };
}
const recaps = (f: FakeAdapter, word: string) => f.sent.filter((t) => t.includes(word));

test("expiry: a poll cycle after awayUntil ends the project and sends the recap once", async () => {
  const x = server();
  await x.tool("set_away", { on: true, minutes: 30 });
  withStore(x.dir, T, (s) => void s.projects.default!.recap.push({ kind: "finished", text: "built it" }));
  x.setNow(T + 31 * MIN);
  await x.away.pollOnce();
  expect(recaps(x.fake, "Away ended (expired)")).toHaveLength(1);
  expect(x.fake.sent.at(-1)).toContain("built it");
  await x.away.pollOnce();
  expect(recaps(x.fake, "Away ended")).toHaveLength(1);
  expect(withStore(x.dir, T, (s) => s.projects.default)).toBeUndefined();
});

test("set_away off sends the recap", async () => {
  const x = server();
  await x.tool("set_away", { on: true });
  await x.tool("set_away", { on: false });
  expect(recaps(x.fake, "Away ended (off)")).toHaveLength(1);
});

test("Teams back sends the recap", async () => {
  const x = server();
  await x.tool("set_away", { on: true });
  x.fake.reply("back", T);
  await x.away.pollOnce();
  expect(recaps(x.fake, "Away ended (back)")).toHaveLength(1);
});

test("terminal end: the server sees awayUntil 0 with an owner and sends the recap", async () => {
  const x = server();
  await x.tool("set_away", { on: true });
  withStore(x.dir, T, (s) => void (s.projects.default!.awayUntil = 0)); // what the hook does
  await x.away.pollOnce();
  expect(recaps(x.fake, "You're back at the terminal.")).toHaveLength(1);
  await x.away.pollOnce();
  expect(recaps(x.fake, "back at the terminal")).toHaveLength(1);
});

test("an edited old yes can't approve a newer request", () => {
  const s = freshStore();
  s.me = "user-1";
  s.projects.a = { ...freshProject("a"), awayUntil: T + 60 * MIN, permissions: [{ id: "abcde", tool: "Bash", at: T }] };
  const msg = {
    id: "m", from: "user-1", text: "yes", at: new Date(T + 5000).toISOString(), sentAt: new Date(T - 5000).toISOString(),
  };
  expect(dispatch(msg, s, T + 10_000).action.kind).toBe("prompt");
});

test("endAway zeroes the snooze", () => {
  const p = busy();
  p.snoozeUntil = T + MIN;
  endAway(p, "back");
  expect(p.snoozeUntil).toBe(0);
});
