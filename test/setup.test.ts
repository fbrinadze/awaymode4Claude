import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter } from "../plugin/server/adapters/adapter.ts";
import { loadTeams } from "../plugin/server/adapters/teams.ts";
import type { Auth } from "../plugin/server/auth.ts";
import { createAway } from "../plugin/server/away.ts";
import type { Json } from "../plugin/server/mcp.ts";
import { load } from "../plugin/server/state.ts";
import { setupTool } from "../plugin/server/setup.ts";
import { fakeNet } from "./fake-net.ts";

const T = Date.parse("2026-11-26T18:00:00Z");
const GRAPH = "https://graph.microsoft.com/v1.0";

function harness(auth: Auth | null, installed: Json[], replies: Json[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "away-setup-"));
  const sent: Json[] = [];
  const { net } = fakeNet([
    [`GET ${GRAPH}/me`, () => ({ id: "user-1" })],
    [`GET ${GRAPH}/users/user-1/teamwork/installedApps/inst-1/chat`, () => ({ id: "19:chat" })],
    [`GET ${GRAPH}/users/user-1/teamwork/installedApps`, () => ({ value: installed })],
    [`GET ${GRAPH}/chats/`, () => ({ value: replies })],
    ["/activities", (r) => (sent.push(JSON.parse(r.body)), { id: "act" })],
    ["POST https://smba.trafficmanager.net/teams/v3/conversations", () => ({ id: "a:conv" })],
  ]);
  let current: Adapter = { send: async () => {}, poll: async () => [], me: async () => "" };
  const out: Json[] = [];
  const away = createAway({
    adapter: { send: (t) => current.send(t), poll: (s) => current.poll(s), me: () => current.me() },
    extraTools: (ctx) => [
      setupTool({ ctx, dir, net, auth, tenantId: "tid", botId: "app", current: () => current, use: (a) => (current = a) }),
    ],
    dir, project: "order-portal", hours: 9, waitMinutes: 60, now: () => T,
    sleep: () => new Promise(() => {}),
    write: (l) => void out.push(JSON.parse(l)),
  });
  let id = 0;
  const setup = async (step: string) => {
    const n = ++id;
    await away.handle(JSON.stringify({ jsonrpc: "2.0", id: n, method: "tools/call", params: { name: "setup", arguments: { step } } }));
    const r = out.find((m) => m.id === n)!.result as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0]!.text, isError: !!r.isError };
  };
  return { dir, sent, setup };
}

const fakeAuth = {
  startDeviceCode: async () => ({ deviceCode: "dc", message: "Go to https://microsoft.com/devicelogin and enter ABCD", interval: 5, expiresAt: 1e15 }),
  finishDeviceCode: async () => {},
  graphToken: async () => "GRAPH",
  botToken: async () => "BOT",
} as Auth;
const ourApp = { id: "inst-1", teamsApp: { externalId: "app" } };
const reply = (text: string, from = "user-1") => ({
  id: text, messageType: "message", lastModifiedDateTime: "2026-11-26T18:01:00.000Z",
  from: { user: { id: from } }, body: { content: text },
});

test("without the three settings, setup says where to enter them", async () => {
  const r = await harness(null, []).setup("start");
  expect(r.isError).toBe(true);
  expect(r.text).toContain("Tenant ID, Bot app ID and Bot secret");
});

test("start → finish: signs in, finds the bot chat, pairs and sends a test message", async () => {
  const h = harness(fakeAuth, [{ id: "other", teamsApp: { externalId: "nope" } }, ourApp]);
  expect((await h.setup("start")).text).toContain("ABCD");
  const r = await h.setup("finish");
  expect(r.isError).toBe(false);
  expect(loadTeams(h.dir)).toEqual({ tenantId: "tid", botId: "app", chatId: "19:chat", me: "user-1", conversationId: "a:conv" });
  expect(load(h.dir).me).toBe("user-1");
  expect(h.sent[0]?.text).toContain("Reply hi to finish pairing");
});

test("finish explains how to add the app when it isn't in Teams yet", async () => {
  const r = await harness(fakeAuth, []).setup("finish");
  expect(r.isError).toBe(true);
  expect(r.text).toContain("Upload a custom app");
});

test("verify waits for your reply, ignores anyone else's", async () => {
  const waiting = harness(fakeAuth, [ourApp], [reply("hi", "stranger")]);
  await waiting.setup("finish");
  expect((await waiting.setup("verify")).text).toContain("No reply yet");

  const paired = harness(fakeAuth, [ourApp], [reply("hi")]);
  await paired.setup("finish");
  expect((await paired.setup("verify")).text).toContain("Paired");
  expect(paired.sent.at(-1)?.text).toContain("Paired");
});
