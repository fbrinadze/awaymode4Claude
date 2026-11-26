import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { htmlToText, loadTeams, teamsAdapter } from "../plugin/server/adapters/teams.ts";
import type { Auth } from "../plugin/server/auth.ts";
import { secretStore } from "../plugin/server/secrets.ts";
import { fakeNet } from "./fake-net.ts";

const auth = { botToken: async () => "BOT", graphToken: async () => "GRAPH" } as Auth;
const cfg = () => ({ tenantId: "tid", botId: "app", chatId: "19:abc@unq.gbl.spaces", me: "user-1" });
const dir = () => mkdtempSync(join(tmpdir(), "away-teams-"));

test("send: creates the 1:1 conversation once, then posts escaped text", async () => {
  const d = dir();
  const { net, calls } = fakeNet([
    ["POST https://smba.trafficmanager.net/teams/v3/conversations/a%3Aconv/activities", () => ({ id: "act" })],
    ["POST https://smba.trafficmanager.net/teams/v3/conversations", () => ({ id: "a:conv" })],
  ]);
  const teams = teamsAdapter(d, cfg(), auth, net);
  await teams.send("[p] Permission needed\nBash: rm -rf <dir> & *");
  await teams.send("again");
  expect(calls.map((c) => c.url.pathname)).toEqual([
    "/teams/v3/conversations",
    "/teams/v3/conversations/a%3Aconv/activities",
    "/teams/v3/conversations/a%3Aconv/activities",
  ]);
  expect(JSON.parse(calls[0]!.body)).toEqual({
    bot: { id: "28:app" },
    isGroup: false,
    members: [{ id: "user-1" }],
    tenantId: "tid",
    channelData: { tenant: { id: "tid" } },
  });
  expect(calls[0]!.auth).toBe("Bearer BOT");
  expect(JSON.parse(calls[1]!.body)).toEqual({
    type: "message",
    textFormat: "xml",
    text: "[p] Permission needed<br>Bash: rm -rf &lt;dir&gt; &amp; *",
  });
  expect(loadTeams(d)?.conversationId).toBe("a:conv");
});

const graphMsg = (id: string, at: string, over: object = {}) => ({
  id,
  messageType: "message",
  lastModifiedDateTime: at,
  from: { user: { id: "user-1" }, application: null },
  body: { contentType: "html", content: `<p>${id}</p>` },
  ...over,
});

test("poll: asks Graph for newer messages and returns your replies oldest first", async () => {
  const page = [
    graphMsg("m4", "2026-11-26T18:00:04.000Z"),
    graphMsg("bot", "2026-11-26T18:00:03.000Z", { from: { user: null, application: { id: "app" } } }),
    graphMsg("sys", "2026-11-26T18:00:03.500Z", { messageType: "systemEventMessage", from: null }),
    graphMsg("edited", "2026-11-26T18:00:02.500Z", { lastEditedDateTime: "2026-11-26T18:00:02.500Z" }),
    graphMsg("gone", "2026-11-26T18:00:02.200Z", { deletedDateTime: "2026-11-26T18:00:02.200Z" }),
    graphMsg("m1", "2026-11-26T18:00:01.000Z", { body: { content: "yes&nbsp;abcde<br>thanks &amp; bye" } }),
  ];
  const { net, calls } = fakeNet([["GET https://graph.microsoft.com/v1.0/chats/", () => ({ value: page })]]);
  const msgs = await teamsAdapter(dir(), cfg(), auth, net).poll("2026-11-26T18:00:00.000Z");
  expect(msgs).toEqual([
    { id: "m1", from: "user-1", text: "yes abcde\nthanks & bye", at: "2026-11-26T18:00:01.000Z" },
    { id: "m4", from: "user-1", text: "m4", at: "2026-11-26T18:00:04.000Z" },
  ]);
  const q = calls[0]!.url.searchParams;
  expect(calls[0]!.url.pathname).toBe("/v1.0/chats/19%3Aabc%40unq.gbl.spaces/messages");
  expect(q.get("$orderby")).toBe("lastModifiedDateTime desc"); // without it Graph ignores $filter
  expect(q.get("$filter")).toBe("lastModifiedDateTime gt 2026-11-26T18:00:00.000Z");
  expect(calls[0]!.auth).toBe("Bearer GRAPH");
});

test("poll with no cursor sends no filter", async () => {
  const { net, calls } = fakeNet([["/chats/", () => ({ value: [] })]]);
  expect(await teamsAdapter(dir(), cfg(), auth, net).poll("")).toEqual([]);
  expect(calls[0]!.url.searchParams.has("$filter")).toBe(false);
});

test("a 429 is retried once after Retry-After", async () => {
  let first = true;
  const { net, slept } = fakeNet([
    ["/chats/", () => (first ? ((first = false), new Response("{}", { status: 429, headers: { "retry-after": "2" } })) : { value: [] })],
  ]);
  expect(await teamsAdapter(dir(), cfg(), auth, net).poll("")).toEqual([]);
  expect(slept).toEqual([2000]);
});

test("htmlToText keeps line breaks and decodes entities", () => {
  expect(htmlToText("<div>use <b>last</b> month</div><p>a &lt;b&gt; &quot;c&quot; &#39;d&#39;</p>")).toBe(
    "use last month\na <b> \"c\" 'd'",
  );
});

test("secret store falls back to a file when the keychain refuses", async () => {
  const d = dir();
  const refuses = {
    get: async () => null,
    set: async () => Promise.reject(new Error("too large")),
    delete: async () => false,
  };
  const store = secretStore(d, refuses);
  await store.set("t", "value");
  expect(await store.get("t")).toBe("value");
  await store.delete("t");
  expect(await store.get("t")).toBeNull();
  writeFileSync(join(d, "x.secret"), "");
  expect(await store.get("x")).toBeNull(); // an empty file isn't a secret
});
