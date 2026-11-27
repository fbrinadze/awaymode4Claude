import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAway } from "../plugin/server/away.ts";
import type { Json } from "../plugin/server/mcp.ts";
import { fresh, load, save } from "../plugin/server/state.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const T = Date.parse("2026-11-26T18:00:00Z");

function harness(endOfDay: "park" | "safest" = "park") {
  const dir = mkdtempSync(join(tmpdir(), "away-relay-"));
  save(dir, { ...fresh(), me: "user-1" });
  const fake = new FakeAdapter("user-1");
  const out: Json[] = [];
  const clock = { t: T };
  const away = createAway({
    adapter: fake, dir, project: "order-portal", hours: 9, waitMinutes: 60,
    neverRelay: ["rm -rf", "deploy"], endOfDay,
    now: () => clock.t, sleep: () => new Promise(() => {}), write: (l) => void out.push(JSON.parse(l)),
  });
  let id = 0;
  const tool = async (name: string, args: Json = {}) => {
    const n = ++id;
    await away.handle(JSON.stringify({ jsonrpc: "2.0", id: n, method: "tools/call", params: { name, arguments: args } }));
    return out.find((m) => m.id === n)!.result as Json;
  };
  const notes = (method: string) => out.filter((m) => m.method === method).map((m) => m.params as Json);
  const reply = async (text: string) => {
    fake.reply(text, clock.t);
    await away.pollOnce();
  };
  const permission = (preview: string) =>
    away.handle(JSON.stringify({
      jsonrpc: "2.0", method: "notifications/claude/channel/permission_request",
      params: { request_id: "abcde", tool_name: "Bash", description: "Run a command", input_preview: preview },
    }));
  return { dir, fake, clock, away, tool, notes, reply, permission };
}

test("never_relay requests stay at the terminal", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await h.permission("rm -rf build");
  expect(h.fake.sent.at(-1)).toContain("Terminal-only approval");
  expect(load(h.dir).permissions).toEqual([]);
  await h.reply("yes abcde");
  expect(h.notes("notifications/claude/channel/permission")).toEqual([]);
});

test("other permission requests are still relayed", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await h.permission("npm run migrate");
  expect(h.fake.sent.at(-1)).toContain('Reply "yes abcde"');
});

test("outbox entries are sent on the next poll and cleared", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  save(h.dir, { ...load(h.dir), outbox: [{ type: "error", text: "Claude stopped: rate_limit" }] });
  await h.away.pollOnce();
  expect(h.fake.sent).toContain("[Claude · order-portal] Error\nClaude stopped: rate_limit");
  expect(load(h.dir).outbox).toEqual([]);
});

test("an unanswered question parks the task after wait_minutes", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await h.tool("ask", { question: "Include archived?" });
  h.clock.t = T + 61 * 60_000;
  await h.away.pollOnce();
  const ev = h.notes("notifications/claude/channel").at(-1)!;
  expect(ev.meta).toEqual({ kind: "timeout", question_id: "q1" });
  expect(String(ev.content)).toContain("park");
  expect(load(h.dir).questions).toEqual([]);
  expect(h.fake.sent.at(-1)).toContain("No reply");
});

test("with safest, the timeout says to continue safely", async () => {
  const h = harness("safest");
  await h.tool("set_away", { on: true });
  await h.tool("ask", { question: "Include archived?" });
  h.clock.t = T + 61 * 60_000;
  await h.away.pollOnce();
  expect(String(h.notes("notifications/claude/channel").at(-1)!.content)).toContain("safest");
});

test("a secret-looking reply is never passed to Claude", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await h.tool("ask", { question: "Which branch?" });
  await h.reply(`ghp_${"x".repeat(36)}`);
  expect(h.notes("notifications/claude/channel")).toEqual([]);
  expect(load(h.dir).questions).toHaveLength(1);
  expect(h.fake.sent.at(-1)).toContain("wasn't passed on");
});

test("a late answer to a timed-out question becomes an instruction", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await h.tool("ask", { question: "Include archived?" });
  h.clock.t = T + 61 * 60_000;
  await h.reply("2");
  const evs = h.notes("notifications/claude/channel");
  expect(evs.map((e) => (e.meta as Json).kind)).toEqual(["timeout", "instruction"]);
});
