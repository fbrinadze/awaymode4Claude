import { expect, test } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installRef, workflowAdapter, type WorkflowConfig } from "../plugin/server/adapters/workflow.ts";
import { fakeNet } from "./fake-net.ts";

const URL_ = "https://default9d72.0f.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?api-version=1&sig=SECRETSIG";
const cfg: WorkflowConfig = { route: "workflow", tenantId: "tid", chatId: "19:c", me: "user-1" };

test("send posts a card to the workflow URL", async () => {
  const { net, calls } = fakeNet([["POST https://default9d72.0f.environment.api.powerplatform.com/", () => new Response(null, { status: 202 })]]);
  await workflowAdapter(cfg, URL_, "k3x9q2ab", async () => "G", net).send("[Claude · app] hi", { project: "app", kind: "reply" });
  expect(calls).toHaveLength(1);
  const body = JSON.parse(calls[0]!.body);
  expect(body.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
  expect(body.attachments[0].content.body[0].text).toBe("Claude Code · app");
  expect(calls[0]!.url.searchParams.get("sig")).toBe("SECRETSIG");
});

test("a 404 error names the flow and not the URL", async () => {
  const { net } = fakeNet([["POST https://default9d72", () => new Response('{"error":"WorkflowNotFound sig=SECRETSIG"}', { status: 404 })]]);
  const err = await workflowAdapter(cfg, URL_, "r", async () => "G", net).send("hi").then(() => null, (e: Error) => e);
  expect(err?.message).toContain("Away Mode workflow");
  expect(err?.message).toContain("404");
  expect(err?.message).not.toContain("SECRETSIG");
  expect(err?.message).not.toContain("powerplatform");
});

test("a network failure doesn't leak the URL either", async () => {
  const net = { fetch: async () => { throw new Error(`connect ECONNREFUSED ${URL_}`); }, sleep: async () => {} };
  const err = await workflowAdapter(cfg, URL_, "r", async () => "G", net).send("hi").then(() => null, (e: Error) => e);
  expect(err?.message).toBe("Couldn't reach the Away Mode workflow.");
});

test("poll ignores app messages and learns tags only from cards with our ref", async () => {
  const card = (ref: string) => ({ contentType: "application/vnd.microsoft.card.adaptive", content: JSON.stringify({ body: [{ type: "TextBlock", text: "Claude Code · app" }, { type: "TextBlock", text: `ref ${ref}` }] }) });
  const app = { user: null, application: { id: "wf" } };
  const quote = (id: string) => ({ contentType: "messageReference", content: JSON.stringify({ messageId: id }) });
  const msg = (id: string, at: string, over: object) => ({ id, messageType: "message", lastModifiedDateTime: at, createdDateTime: at, from: { user: { id: "user-1" } }, body: { content: `<p>${id}</p>` }, ...over });
  const page = [
    msg("r2", "2026-11-26T18:00:06.000Z", { attachments: [quote("b")] }),
    msg("r1", "2026-11-26T18:00:05.000Z", { attachments: [quote("a")] }),
    msg("b", "2026-11-26T18:00:04.000Z", { from: app, attachments: [card("other")] }),
    msg("a", "2026-11-26T18:00:03.000Z", { from: app, attachments: [card("k3x9q2ab")] }),
  ];
  const { net } = fakeNet([["GET https://graph.microsoft.com/v1.0/chats/", () => ({ value: page })]]);
  const msgs = await workflowAdapter(cfg, URL_, "k3x9q2ab", async () => "G", net).poll("");
  expect(msgs.map((m) => [m.id, m.replyTag])).toEqual([["r1", "app"], ["r2", undefined]]);
});

test("installRef is stable, 8 lowercase alphanumerics, owner-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "away-ref-"));
  const a = installRef(dir);
  expect(a).toMatch(/^[a-z0-9]{8}$/);
  expect(installRef(dir)).toBe(a);
  if (process.platform !== "win32") expect(statSync(join(dir, "ref.txt")).mode & 0o777).toBe(0o600);
});
