// v1.2.0 Task 2: every message carries project and kind for adapters that render a header.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAway } from "../plugin/server/away.ts";
import type { Json } from "../plugin/server/mcp.ts";
import { projectKey } from "../plugin/server/project.ts";
import { withStore } from "../plugin/server/store.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const T = Date.parse("2026-11-26T18:00:00Z");
const MIN = 60_000;

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "away-"));
  withStore(dir, T, (s) => void (s.me = "user-1"));
  const clock = { now: T };
  const fake = new FakeAdapter("user-1");
  const away = createAway({
    adapter: fake, dir, key: projectKey("/a"), project: "a", hours: 9, waitMinutes: 60,
    now: () => clock.now, sleep: () => new Promise(() => {}), write: () => {},
  });
  let id = 0;
  const tool = (name: string, args: Json) =>
    away.handle(JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }));
  return { fake, away, tool, clock };
}

test("ask sends kind question", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  void h.tool("ask", { question: "Include archived?" });
  await new Promise((r) => setTimeout(r, 20));
  expect(h.fake.meta.at(-1)).toEqual({ project: "a", kind: "question" });
});

test("a permission request sends kind approval", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  const params = { request_id: "abcde", tool_name: "Bash", description: "Run migration", input_preview: "npm run migrate" };
  await h.away.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/claude/channel/permission_request", params }));
  expect(h.fake.meta.at(-1)).toEqual({ project: "a", kind: "approval", code: "npm run migrate" });
});

test("notify finished sends kind done", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await h.tool("notify", { type: "finished", text: "Exported 3 reports." });
  expect(h.fake.meta.at(-1)).toEqual({ project: "a", kind: "done" });
});

test("an expiry recap sends kind recap", async () => {
  const h = harness();
  await h.tool("set_away", { on: true, minutes: 30 });
  h.clock.now = T + 31 * MIN;
  await h.away.pollOnce();
  expect(h.fake.meta.at(-1)?.kind).toBe("recap");
});

test("bot-route text is unchanged", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  const params = { request_id: "abcde", tool_name: "Bash", description: "Run migration", input_preview: "npm run migrate" };
  await h.away.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/claude/channel/permission_request", params }));
  expect(h.fake.sent.at(-1)).toBe(
    '[Claude · a] Permission needed\nBash: Run migration\nnpm run migrate\nReply "yes abcde" or "no abcde".',
  );
});
