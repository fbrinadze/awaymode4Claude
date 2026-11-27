import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Auth } from "../plugin/server/auth.ts";
import { doctorTool, type DoctorDeps } from "../plugin/server/doctor.ts";
import { fakeNet } from "./fake-net.ts";

const T = Date.parse("2026-11-27T12:00:00Z");
const SECRET = "S3cr3t-dummy";
const auth = { graphToken: async () => "GRAPH" } as Auth;

function deps(over: Partial<DoctorDeps> = {}, me: () => unknown = () => ({ id: "user-1" })) {
  const dir = mkdtempSync(join(tmpdir(), "away-doctor-"));
  const sent: string[] = [];
  const { net } = fakeNet([["GET https://graph.microsoft.com/v1.0/me", me]]);
  const d: DoctorDeps = {
    dir, net, auth, tenantId: "tid", botId: "bot", hasSecret: true, now: () => T,
    version: "1.1.0", bunVersion: "1.3.0",
    current: () => ({ send: async (t) => void sent.push(t), poll: async () => [], me: async () => "user-1" }),
    ...over,
  };
  return { d, dir, sent };
}
const pair = (dir: string) => {
  writeFileSync(join(dir, "teams.json"), JSON.stringify({ tenantId: "tid", botId: "bot", chatId: "19:c", me: "user-1" }));
  // Owner-only, as the real store writes it; the doctor flags anything looser on macOS/Linux.
  writeFileSync(join(dir, "state.json"), JSON.stringify({ version: 2, me: "user-1", cursor: "", nextQ: 1, lease: null, projects: {} }), { mode: 0o600 });
};
const run = async (d: DoctorDeps, args = {}) => (await doctorTool(d).run(args)).split("\n");

test("no tenant settings: says where to set them, and still reports the rest", async () => {
  const { d } = deps({ tenantId: "", botId: "", hasSecret: false, auth: null });
  const lines = await run(d);
  expect(lines).toContain("✘ settings: run setup\\install.ps1 or set them under /plugin");
  expect(lines.some((l) => l.startsWith("✘ sign-in"))).toBe(true);
  expect(lines.some((l) => l.startsWith("✘ bot chat"))).toBe(true);
});

test("/me returning 401 means sign-in again", async () => {
  const { d } = deps({}, () => new Response("{}", { status: 401 }));
  expect(await run(d)).toContain("✘ sign-in: run /away-mode:setup");
});

test("everything fine: every line starts with a tick, and the secret never shows", async () => {
  const { d, dir } = deps();
  pair(dir);
  const lines = await run(d);
  expect(lines.length).toBeGreaterThanOrEqual(9);
  for (const l of lines) expect(l.startsWith("✔")).toBe(true);
  expect(lines.join("\n")).not.toContain(SECRET);
});

test("send_test sends one message through the current adapter", async () => {
  const { d, dir, sent } = deps();
  pair(dir);
  const lines = await run(d, { send_test: true });
  expect(sent.length).toBe(1);
  expect(lines.at(-1)).toStartWith("✔ test message");
});

test("send_test failure is reported, not thrown", async () => {
  const { d } = deps({ current: () => ({ send: async () => { throw new Error("nope"); }, poll: async () => [], me: async () => "" }) });
  expect((await run(d, { send_test: true })).at(-1)).toStartWith("✘ test message");
});
