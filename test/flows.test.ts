import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAway } from "../plugin/server/away.ts";
import type { Json } from "../plugin/server/mcp.ts";
import { fresh, load, save } from "../plugin/server/state.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const T = Date.parse("2026-11-26T18:00:00Z");
let fake: FakeAdapter, dir: string, out: Json[], away: ReturnType<typeof createAway>, seq: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "away-"));
  save(dir, { ...fresh(), me: "user-1" });
  fake = new FakeAdapter("user-1");
  out = [];
  seq = 0;
  away = createAway({
    adapter: fake,
    dir,
    project: "order-portal",
    hours: 9,
    waitMinutes: 60,
    now: () => T,
    sleep: () => new Promise(() => {}), // poll loop runs once; tests drive pollOnce
    write: (l) => void out.push(JSON.parse(l)),
  });
});

async function tool(name: string, args: Json = {}): Promise<Json> {
  const id = ++seq;
  await away.handle(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }));
  return out.find((m) => m.id === id)!.result as Json;
}
const notes = (method: string) => out.filter((m) => m.method === method).map((m) => m.params);
const channel = () => notes("notifications/claude/channel");
const verdicts = () => notes("notifications/claude/channel/permission");
async function reply(text: string, from?: string) {
  fake.reply(text, T, from);
  await away.pollOnce();
}
async function permissionRequest(id: string) {
  const params = { request_id: id, tool_name: "Bash", description: "Run migration", input_preview: "npm run migrate" };
  await away.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/claude/channel/permission_request", params }));
}

test("nothing goes to Teams while not away", async () => {
  expect((await tool("ask", { question: "?" })).isError).toBe(true);
  expect((await tool("notify", { type: "finished", text: "done" })).isError).toBe(true);
  await permissionRequest("abcde");
  expect(fake.sent).toEqual([]);
});

test("question: ask, reply with an option number, answer reaches Claude", async () => {
  await tool("set_away", { on: true });
  const r = await tool("ask", { question: "Include archived orders?", options: ["yes", "no"] });
  expect(JSON.stringify(r)).toContain("q1");
  expect(fake.sent[0]).toBe("[order-portal] Question q1\nInclude archived orders?\nReply 1 = yes, 2 = no, or type an answer.");
  await reply("2");
  expect(channel()).toEqual([{ content: "2 (no)", meta: { kind: "answer", question_id: "q1" } }]);
  expect(fake.sent.at(-1)).toBe("[order-portal] Got it.");
  expect(load(dir).questions).toEqual([]);
});

test("permission: relayed with its ID, approved from Teams", async () => {
  await tool("set_away", { on: true });
  await permissionRequest("abcde");
  expect(fake.sent[0]).toContain('Bash: Run migration\nnpm run migrate\nReply "yes abcde" or "no abcde".');
  await reply("yes abcde");
  expect(verdicts()).toEqual([{ request_id: "abcde", behavior: "allow" }]);
  expect(load(dir).permissions).toEqual([]);
});

test("permission: denied, and an unknown ID approves nothing", async () => {
  await tool("set_away", { on: true });
  await permissionRequest("abcde");
  await reply("yes zzzzz");
  expect(verdicts()).toEqual([]);
  await reply("no abcde");
  expect(verdicts()).toEqual([{ request_id: "abcde", behavior: "deny" }]);
});

test("a stranger's reply is dropped silently", async () => {
  await tool("set_away", { on: true });
  await permissionRequest("abcde");
  await reply("yes abcde", "intruder");
  expect(verdicts()).toEqual([]);
  expect(fake.sent).toHaveLength(1);
});

test("finished and error notes carry the project name", async () => {
  await tool("set_away", { on: true });
  await tool("notify", { type: "finished", text: "Exported 3 reports." });
  await tool("notify", { type: "error", text: "Tests fail on Windows." });
  expect(fake.sent).toEqual(["[order-portal] Done\nExported 3 reports.", "[order-portal] Error\nTests fail on Windows."]);
  expect((await tool("notify", { type: "toString", text: "x" })).isError).toBe(true);
});

test("messages are capped at 1,200 characters", async () => {
  await tool("set_away", { on: true });
  await tool("notify", { type: "info", text: "x".repeat(5000) });
  expect(fake.sent[0]).toHaveLength(1200);
});

test("free text becomes an instruction; back ends away mode from Teams", async () => {
  await tool("set_away", { on: true });
  await reply("also update the README");
  await reply("back");
  expect(channel().map((c) => (c as Json).meta)).toEqual([{ kind: "instruction" }, { kind: "back" }]);
  expect(load(dir).awayUntil).toBe(0);
});

test("set_away rejects a past end time and defaults to away_hours", async () => {
  expect((await tool("set_away", { on: true, until: "2020-01-01T00:00:00Z" })).isError).toBe(true);
  await tool("set_away", { on: true });
  expect(load(dir).awayUntil).toBe(T + 9 * 3_600_000);
  expect(load(dir).cursor).toBe(new Date(T).toISOString());
});

test("set_away tells Claude when to call it", async () => {
  await away.handle(JSON.stringify({ jsonrpc: "2.0", id: 999, method: "tools/list" }));
  const tools = (out.find((m) => m.id === 999)!.result as { tools: { name: string; description: string }[] }).tools;
  const description = tools.find((t) => t.name === "set_away")!.description;
  expect(description).toMatch(/stepping away/);
  expect(description).toMatch(/lunch/);
  expect(description).toMatch(/back/);
});
