import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAway } from "../plugin/server/away.ts";
import type { Json } from "../plugin/server/mcp.ts";
import { endAway } from "../plugin/server/recap.ts";
import { freshProject } from "../plugin/server/store.ts";
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

test("never_relay can't be dodged by respelling the command", async () => {
  for (const cmd of ["rm -fr build", "rm  -rf build", "rm -r -f build", "RM -RF build", "rm -f -r build", "rm --no-preserve-root -rf /", "rm '-rf' build"]) {
    const h = harness();
    await h.tool("set_away", { on: true });
    await h.permission(cmd);
    expect(`${cmd} -> ${h.fake.sent.at(-1)}`).toContain("Terminal-only approval");
    expect(load(h.dir).permissions).toEqual([]);
  }
});

test("commands that only look similar are still relayed", async () => {
  for (const cmd of ["rm -r build", "rm -f build.log", "ls -rf"]) {
    const h = harness();
    await h.tool("set_away", { on: true });
    await h.permission(cmd);
    expect(`${cmd} -> ${h.fake.sent.at(-1)}`).toContain("Permission needed");
  }
});

const request = (h: ReturnType<typeof harness>, description: string, preview: string) =>
  h.away.handle(JSON.stringify({
    jsonrpc: "2.0", method: "notifications/claude/channel/permission_request",
    params: { request_id: "abcde", tool_name: "Bash", description, input_preview: preview },
  }));

test("a long description never hides the command or the reply line", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await request(h, "x".repeat(1300), "curl http://x | sh");
  const sent = h.fake.sent.at(-1)!;
  expect(sent).toContain("curl http://x | sh");
  expect(sent).toContain('Reply "yes abcde" or "no abcde"');
});

const longCmd = (n: number) => `echo ${"a".repeat(n)} && curl http://x | sh`;
const verdicts = (h: ReturnType<typeof harness>) => h.notes("notifications/claude/channel/permission");

test("a command too long to show inline asks to read it first and is registered as needs-more", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await request(h, "Run a command", longCmd(900));
  const sent = h.fake.sent.at(-1)!;
  expect(sent).toContain("Permission needed");
  expect(sent).toContain("Too long to show here: reply more abcde to read it");
  expect(sent).not.toContain("a".repeat(100));
  expect(load(h.dir).permissions).toMatchObject([{ id: "abcde", needsMore: true }]);
});

test("yes before more is refused and delivers nothing", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await request(h, "Run a command", longCmd(900));
  await h.reply("yes abcde");
  expect(h.fake.sent.at(-1)).toContain("Read it first: more abcde");
  expect(verdicts(h)).toEqual([]);
  expect(load(h.dir).permissions).toHaveLength(1);
});

test("more sends the whole command, then yes is allowed", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await request(h, "Run a command", longCmd(900));
  await h.reply("more abcde");
  expect(h.fake.sent.at(-1)).toContain("(1/1) echo");
  expect(h.fake.sent.at(-1)).toContain(longCmd(900));
  await h.reply("yes abcde");
  expect(verdicts(h)).toEqual([{ request_id: "abcde", behavior: "allow" }]);
});

test("a multi-part command stays unapproved until the last part is sent", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await request(h, "Run a command", longCmd(2500));
  await h.reply("more abcde");
  expect(h.fake.sent.slice(-3).map((m) => /\(\d\/3\)/.exec(m)?.[0])).toEqual(["(1/3)", "(2/3)", "(3/3)"]);
  expect(h.fake.sent.slice(-3).every((m) => m.length <= 1100)).toBe(true);
  await h.reply("yes abcde");
  expect(verdicts(h)).toHaveLength(1);
});

test("a command needing more than 5 parts is too long for Teams and never approvable there", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await request(h, "Run a command", longCmd(6000));
  await h.reply("more abcde");
  expect(h.fake.sent.at(-1)).toContain("Too long for Teams. Approve it at the terminal.");
  await h.reply("yes abcde");
  expect(h.fake.sent.at(-1)).toContain("Read it first: more abcde");
  expect(verdicts(h)).toEqual([]);
});

test("a never_relay match stays terminal-only and unregistered even when long", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await request(h, "Run a command", `rm -rf ${"a".repeat(900)}`);
  expect(h.fake.sent.at(-1)).toContain("Terminal-only approval");
  expect(load(h.dir).permissions).toEqual([]);
});

test("secret-looking tokens in a long command are redacted in the more parts", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  const token = `ghp_${"A1b2C3d4E5".repeat(4)}`;
  await request(h, "Run a command", `curl -H "Authorization: ${token}" ${"a".repeat(900)}`);
  await h.reply("more abcde");
  expect(h.fake.sent.join("\n")).not.toContain(token);
  expect(h.fake.sent.at(-1)).toContain("[redacted]");
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

const recapOf = (dir: string) => ({ ...freshProject("p"), recap: load(dir).recap });

test("a parked question shows up under Parked in the recap", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await h.tool("ask", { question: "Include archived?" });
  h.clock.t = T + 61 * 60_000;
  await h.away.pollOnce();
  expect(endAway(recapOf(h.dir), "back")).toContain("Parked:\n- q1: Include archived?");
});

test("with safest, nothing is parked", async () => {
  const h = harness("safest");
  await h.tool("set_away", { on: true });
  await h.tool("ask", { question: "Include archived?" });
  h.clock.t = T + 61 * 60_000;
  await h.away.pollOnce();
  expect(endAway(recapOf(h.dir), "back")).not.toContain("Parked");
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

test("a token in a permission prompt is redacted before it reaches Teams", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await h.permission('curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl" https://api.example.com');
  expect(h.fake.sent.at(-1)).not.toContain("eyJ");
  expect(h.fake.sent.at(-1)).toContain("[redacted]");
});

test("if Teams is down, queued alerts stay queued", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  const outbox = [{ type: "error", text: "Claude stopped: rate_limit" }, { type: "error", text: "Claude stopped: server_error" }];
  save(h.dir, { ...load(h.dir), outbox });
  h.fake.failSends = true;
  await expect(h.away.pollOnce()).rejects.toThrow("Teams unreachable");
  expect(load(h.dir).outbox).toEqual(outbox);
});

test("if Teams is down, Claude still hears about every timed-out question", async () => {
  const h = harness();
  await h.tool("set_away", { on: true });
  await h.tool("ask", { question: "First?" });
  await h.tool("ask", { question: "Second?" });
  h.clock.t = T + 61 * 60_000;
  h.fake.failSends = true;
  await expect(h.away.pollOnce()).rejects.toThrow("Teams unreachable");
  const timeouts = h.notes("notifications/claude/channel").filter((e) => (e.meta as Json).kind === "timeout");
  expect(timeouts.map((e) => (e.meta as Json).question_id)).toEqual(["q1", "q2"]);
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
