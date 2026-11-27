import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slackAdapter } from "../plugin/server/adapters/slack.ts";
import { createAway } from "../plugin/server/away.ts";
import type { Json } from "../plugin/server/mcp.ts";
import { fresh, load, save } from "../plugin/server/state.ts";
import { fakeNet } from "./fake-net.ts";
import { dm, socketFactory } from "./fake-socket.ts";

// Phase 5 Check: the Phase 1 flows (test/flows.test.ts) through the real Slack adapter over fakes.
const T = Date.parse("2026-11-26T18:00:00Z");
let sent: string[], dir: string, out: Json[], away: ReturnType<typeof createAway>, seq: number, n: number;
let sock: ReturnType<typeof socketFactory>, slack: ReturnType<typeof slackAdapter>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "away-slack-"));
  save(dir, { ...fresh(), me: "U1" });
  sent = [];
  out = [];
  seq = 0;
  n = 0;
  sock = socketFactory();
  const { net } = fakeNet([
    ["apps.connections.open", () => ({ ok: true, url: "wss://fake/1" })],
    ["conversations.open", () => ({ ok: true, channel: { id: "D1" } })],
    ["chat.postMessage", (r) => (sent.push(JSON.parse(r.body).text), { ok: true })],
  ]);
  slack = slackAdapter({ botToken: "xoxb-test", appToken: "xapp-test", me: "U1" }, net, sock.open);
  await slack.start();
  away = createAway({
    adapter: slack,
    dir,
    project: "order-portal",
    hours: 9,
    waitMinutes: 60,
    now: () => T,
    sleep: () => new Promise(() => {}),
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
async function reply(text: string, user = "U1") {
  n++;
  sock.sockets[0]!.receive(dm(`env${n}`, `${T / 1000 + n}.000100`, text, {}, user));
  await away.pollOnce();
}
async function permissionRequest(id: string) {
  const params = { request_id: id, tool_name: "Bash", description: "Run migration", input_preview: "npm run migrate" };
  await away.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/claude/channel/permission_request", params }));
}

test("question: ask over Slack, reply with an option number", async () => {
  await tool("set_away", { on: true });
  await tool("ask", { question: "Include archived orders?", options: ["yes", "no"] });
  expect(sent[0]).toBe("[Claude · order-portal] Question q1\nInclude archived orders?\nReply 1 = yes, 2 = no, or type an answer.");
  await reply("2");
  expect(channel()).toEqual([{ content: "2 (no)", meta: { kind: "answer", question_id: "q1" } }]);
  expect(sent.at(-1)).toBe("[Claude · order-portal] Got it.");
  expect(load(dir).questions).toEqual([]);
});

test("permission: relayed with its ID, approved and denied from Slack", async () => {
  await tool("set_away", { on: true });
  await permissionRequest("abcde");
  expect(sent[0]).toContain('Bash: Run migration\nnpm run migrate\nReply "yes abcde" or "no abcde".');
  await reply("yes zzzzz");
  expect(verdicts()).toEqual([]);
  await reply("yes abcde");
  expect(verdicts()).toEqual([{ request_id: "abcde", behavior: "allow" }]);
  await permissionRequest("fghij");
  await reply("no fghij");
  expect(verdicts().at(-1)).toEqual({ request_id: "fghij", behavior: "deny" });
});

test("a stranger's Slack reply is dropped silently", async () => {
  await tool("set_away", { on: true });
  await permissionRequest("abcde");
  await reply("yes abcde", "U2");
  expect(verdicts()).toEqual([]);
  expect(sent).toHaveLength(1);
});

test("finished and error notes carry the project name, with Slack escaping", async () => {
  await tool("set_away", { on: true });
  await tool("notify", { type: "finished", text: "Exported 3 reports." });
  await tool("notify", { type: "error", text: "a < b & c" });
  expect(sent).toEqual(["[Claude · order-portal] Done\nExported 3 reports.", "[Claude · order-portal] Error\na &lt; b &amp; c"]);
});

test("free text becomes an instruction; back ends away mode from Slack", async () => {
  await tool("set_away", { on: true });
  await reply("also update the README");
  await reply("back");
  expect(channel().map((c) => (c as Json).meta)).toEqual([{ kind: "instruction" }, { kind: "back" }]);
  expect(load(dir).awayUntil).toBe(0);
});
