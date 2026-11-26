import { expect, test } from "bun:test";
import { createServer, type Json, type Tool } from "../plugin/server/mcp.ts";

function harness(tools: Tool[] = []) {
  const out: Json[] = [];
  const notes: [string, Json][] = [];
  const raw: string[] = [];
  const server = createServer(
    { name: "t", version: "0", instructions: "hello", tools, onNotification: async (m, p) => void notes.push([m, p]) },
    (line) => {
      raw.push(line);
      out.push(JSON.parse(line));
    },
  );
  const send = (msg: Json) => server.handle(JSON.stringify({ jsonrpc: "2.0", ...msg }));
  return { out, notes, raw, send, server };
}

const echo: Tool = {
  name: "echo",
  description: "d",
  inputSchema: { type: "object" },
  run: async (a) => `got ${a.x}`,
};
const boom: Tool = { ...echo, name: "boom", run: async () => Promise.reject(new Error("nope")) };

test("initialize declares channel, permission relay and tools", async () => {
  const h = harness();
  await h.send({ id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } });
  const r = h.out[0]!.result as Json;
  expect(r.protocolVersion).toBe("2025-11-25");
  expect(r.capabilities).toEqual({
    experimental: { "claude/channel": {}, "claude/channel/permission": {} },
    tools: {},
  });
  expect(r.instructions).toBe("hello");
  expect(h.raw[0]!.endsWith("\n")).toBe(true);
});

test("initialize never negotiates the revision channels can't use", async () => {
  const h = harness();
  await h.send({ id: 1, method: "initialize", params: { protocolVersion: "2026-07-28" } });
  await h.send({ id: 2, method: "initialize", params: {} });
  expect((h.out[0]!.result as Json).protocolVersion).toBe("2025-06-18");
  expect((h.out[1]!.result as Json).protocolVersion).toBe("2025-06-18");
});

test("tools/list hides the run function", async () => {
  const h = harness([echo]);
  await h.send({ id: 1, method: "tools/list" });
  expect(h.out[0]!.result).toEqual({ tools: [{ name: "echo", description: "d", inputSchema: { type: "object" } }] });
});

test("tools/call returns text, and tool errors come back as isError", async () => {
  const h = harness([echo, boom]);
  await h.send({ id: 1, method: "tools/call", params: { name: "echo", arguments: { x: 7 } } });
  await h.send({ id: 2, method: "tools/call", params: { name: "boom" } });
  expect(h.out[0]!.result).toEqual({ content: [{ type: "text", text: "got 7" }] });
  expect(h.out[1]!.result).toEqual({ content: [{ type: "text", text: "nope" }], isError: true });
});

test("unknown tool, unknown method and bad JSON are JSON-RPC errors", async () => {
  const h = harness();
  await h.send({ id: 1, method: "tools/call", params: { name: "nope" } });
  await h.send({ id: 2, method: "resources/list" });
  await h.server.handle("{not json");
  expect(h.out.map((m) => (m.error as Json).code)).toEqual([-32602, -32601, -32700]);
});

test("notifications reach the handler and get no response", async () => {
  const h = harness();
  await h.send({ method: "notifications/initialized" });
  expect(h.notes).toEqual([["notifications/initialized", {}]]);
  expect(h.out).toEqual([]);
});

test("responses from the client are ignored", async () => {
  const h = harness();
  await h.send({ id: 9, result: {} });
  expect(h.out).toEqual([]);
});

test("notify writes a JSON-RPC notification", () => {
  const h = harness();
  h.server.notify("notifications/claude/channel", { content: "hi" });
  expect(h.out[0]).toEqual({ jsonrpc: "2.0", method: "notifications/claude/channel", params: { content: "hi" } });
});
