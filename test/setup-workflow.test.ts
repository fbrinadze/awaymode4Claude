import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Auth } from "../plugin/server/auth.ts";
import { HttpError } from "../plugin/server/http.ts";
import { consentHelp, pairWorkflow, scopeWarning } from "../plugin/server/setup-workflow.ts";
import { fakeNet } from "./fake-net.ts";

const WF = "https://wf.example.test/invoke?sig=S";
const jwt = (scp: string) => `h.${Buffer.from(JSON.stringify({ scp })).toString("base64url")}.s`;
const auth = (scp = "User.Read Chat.Read") => ({ graphToken: async () => jwt(scp) }) as unknown as Auth;
const card = (...texts: string[]) => ({
  contentType: "application/vnd.microsoft.card.adaptive",
  content: JSON.stringify({ body: texts.map((text) => ({ type: "TextBlock", text })) }),
});
const appMsg = (texts: string[]) => ({ id: "m", messageType: "message", lastModifiedDateTime: "x", from: { user: null, application: { id: "wf" } }, attachments: [card(...texts)] });

function net(chats: Record<string, unknown[]>, onPost = () => {}) {
  return fakeNet([
    ["POST https://wf.example.test/", () => (onPost(), new Response(null, { status: 202 }))],
    ["GET https://graph.microsoft.com/v1.0/me/chats", () => ({ value: Object.keys(chats).map((id) => ({ id })) })],
    ...Object.entries(chats).map(([id, msgs]): [string, () => unknown] => [`GET https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(id)}/messages`, () => ({ value: msgs })]),
    ["GET https://graph.microsoft.com/v1.0/me", () => ({ id: "user-1" })],
  ]);
}
const opts = (n: ReturnType<typeof net>["net"], dir = mkdtempSync(join(tmpdir(), "away-wf-"))) => ({
  dir, net: n, auth: auth(), url: WF, ref: "k3x9q2ab", tenantId: "tid", code: "PAIR42", sleep: async () => {},
});

test("finds the chat by code and ref, and saves it", async () => {
  const { net: n } = net({ "19:a": [appMsg(["Claude Code", "Pairing code PAIR42", "ref k3x9q2ab"])] });
  const o = opts(n);
  const cfg = await pairWorkflow(o);
  expect(cfg).toEqual({ route: "workflow", tenantId: "tid", chatId: "19:a", me: "user-1" });
  expect(JSON.parse(readFileSync(join(o.dir, "teams.json"), "utf8")).chatId).toBe("19:a");
});

test("a chat with the code but no ref is not chosen", async () => {
  const { net: n } = net({
    "19:fake": [appMsg(["Claude Code", "Pairing code PAIR42", "ref zzzzzzzz"])],
    "19:real": [appMsg(["Claude Code", "Pairing code PAIR42", "ref k3x9q2ab"])],
  });
  expect((await pairWorkflow(opts(n))).chatId).toBe("19:real");
});

test("gives up with the flow hint", async () => {
  const { net: n } = net({ "19:a": [] });
  const err = await pairWorkflow(opts(n)).then(() => null, (e: Error) => e);
  expect(err?.message).toContain("Chat with Flow bot");
  expect(err?.message).not.toContain("sig=");
});

test("a broad token gives a warning; a narrow one none", async () => {
  expect(await scopeWarning(auth("User.Read Chat.Read openid profile offline_access"))).toBeUndefined();
  const w = await scopeWarning(auth("User.Read Chat.Read Directory.ReadWrite.All"));
  expect(w).toContain("Directory.ReadWrite.All");
  expect(w).toContain("own app registration");
});

test("setup finish on the workflow route: warns first on a broad token, pairs once accepted, then sends through the flow", async () => {
  const { createAway } = await import("../plugin/server/away.ts");
  const { setupTool } = await import("../plugin/server/setup.ts");
  let posts = 0;
  const { net: n } = net({ "19:a": [] }, () => void posts++);
  // The pairing card is found by whatever code it carried: echo the last posted card back into the chat.
  const posted: string[] = [];
  const echo = { fetch: async (u: string, init?: RequestInit) => {
    if (u.startsWith("https://wf.example.test/")) posted.push(String(init?.body));
    if (u.includes("/chats/19%3Aa/messages") && posted.length) {
      const c = JSON.parse(posted.at(-1)!).attachments[0];
      return Response.json({ value: [{ id: "m", messageType: "message", lastModifiedDateTime: "x", from: { application: { id: "wf" } }, attachments: [{ contentType: c.contentType, content: JSON.stringify(c.content) }] }] });
    }
    return n.fetch(u, init);
  }, sleep: async () => {} };
  const dir = mkdtempSync(join(tmpdir(), "away-wfs-"));
  let current = { send: async (_t: string) => {}, poll: async () => [], me: async () => "" } as import("../plugin/server/adapters/adapter.ts").Adapter;
  const out: Record<string, unknown>[] = [];
  const away = createAway({
    adapter: { send: (t, m) => current.send(t, m), poll: (s) => current.poll(s), me: () => current.me() },
    extraTools: (ctx) => [setupTool({ ctx, dir, net: echo, auth: auth("User.Read Chat.Read Directory.ReadWrite.All"), tenantId: "tid", botId: "", current: () => current, use: (a) => (current = a), workflow: { url: WF, ref: "k3x9q2ab" } })],
    dir, project: "p", hours: 9, waitMinutes: 60, now: () => Date.parse("2026-11-26T18:00:00Z"), sleep: () => new Promise(() => {}), write: (l) => void out.push(JSON.parse(l)),
  });
  let id = 0;
  const finish = async (args: Record<string, unknown>) => {
    const k = ++id;
    await away.handle(JSON.stringify({ jsonrpc: "2.0", id: k, method: "tools/call", params: { name: "setup", arguments: { step: "finish", ...args } } }));
    return ((out.find((m) => m.id === k)!.result as { content: { text: string }[] }).content[0]!.text);
  };
  expect(await finish({})).toContain("Directory.ReadWrite.All");
  expect(posted).toHaveLength(0);
  expect(await finish({ accept_scopes: true })).toContain("verify");
  expect(posted).toHaveLength(1);
  await current.send("hello", { kind: "reply" });
  expect(posted).toHaveLength(2);
});

test("consent errors explain the admin step and the graph-tools option", () => {
  const e = new HttpError(400, { error: "invalid_grant", error_description: "AADSTS65001: The user or administrator has not consented" }, "x");
  expect(consentHelp(e)?.message).toContain("-SignInApp graph-tools");
  expect(consentHelp(new HttpError(400, { error: "consent_required" }, "x"))).toBeDefined();
  expect(consentHelp(new Error("other"))).toBeUndefined();
});
