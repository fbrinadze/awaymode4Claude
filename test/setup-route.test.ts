// Setup on the workflow route when its settings are incomplete, and cancelling a declined sign-in.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Auth } from "../plugin/server/auth.ts";
import { setupTool, type SetupDeps } from "../plugin/server/setup.ts";
import type { Ctx } from "../plugin/server/tools.ts";
import { fakeNet } from "./fake-net.ts";

function tool(over: Partial<SetupDeps>) {
  const { net } = fakeNet([]);
  return setupTool({
    ctx: {} as Ctx, dir: mkdtempSync(join(tmpdir(), "away-sr-")), net, auth: null, tenantId: "", botId: "",
    current: () => ({ send: async () => {}, poll: async () => [], me: async () => "" }), use: () => {}, ...over,
  });
}
const error = (p: Promise<unknown>) => p.then(() => "", (e: Error) => e.message);

test("workflow route without a sign-in app: says to rerun the installer for the workflow route, not bot settings", async () => {
  const msg = await error(tool({ route: "workflow" }).run({ step: "start" }));
  expect(msg).toContain("-Route workflow");
  expect(msg).not.toContain("Bot secret");
});

test("workflow route without a workflow URL: same, even when sign-in is set", async () => {
  const auth = { startDeviceCode: async () => ({}) } as unknown as Auth;
  const msg = await error(tool({ route: "workflow", auth }).run({ step: "finish" }));
  expect(msg).toContain("-Route workflow");
});

test("cancel forgets the saved sign-in", async () => {
  let out = false;
  const auth = { signOut: async () => void (out = true) } as unknown as Auth;
  const text = await tool({ route: "workflow", auth, workflow: { url: "https://x.test", ref: "r" } }).run({ step: "cancel" });
  expect(out).toBe(true);
  expect(String(text)).toContain("removed");
});
