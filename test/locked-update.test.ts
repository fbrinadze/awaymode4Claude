// Updates must read and write under one lock. Another process (a hook, a second server) holds the
// lock while it writes; a stale unlocked read taken before that write must not overwrite it.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { projectKeyOf } from "../plugin/hooks/hook.ts";
import { createAway } from "../plugin/server/away.ts";
import { freshProject, withStore } from "../plugin/server/store.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const STORE_URL = pathToFileURL(join(import.meta.dir, "../plugin/server/store.ts")).href;

/** A second process takes the lock, applies `mutate` to the store `s`, holds the lock a while, then writes. */
async function otherWriter(dir: string, mutate: string) {
  const code = `import { withStore } from ${JSON.stringify(STORE_URL)};
    withStore(${JSON.stringify(dir)}, Date.now(), (s) => { ${mutate}; Bun.sleepSync(700); });`;
  const proc = Bun.spawn(["bun", "-e", code], { stdout: "inherit", stderr: "inherit" });
  while (!existsSync(join(dir, "state.lock"))) await new Promise((r) => setTimeout(r, 5));
  return proc;
}

function server(key: string) {
  const dir = mkdtempSync(join(tmpdir(), "away-lock-"));
  const now = Date.now();
  withStore(dir, now, (s) => void (s.me = "user-1"));
  const away = createAway({
    adapter: new FakeAdapter("user-1"), dir, key, instance: "I1", project: "p", hours: 9, waitMinutes: 60,
    now: () => Date.now(), sleep: () => new Promise<void>(() => {}), write: () => {},
  });
  return { dir, away };
}

test("a hook-style write made after the server's read survives the server's update", async () => {
  const { dir, away } = server("a");
  await away.handle(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "set_away", arguments: { on: true } } }));
  const proc = await otherWriter(dir, `s.projects["a"].awayUntil = 0; s.projects["a"].questions.push({ id: "q9", text: "t", options: [] })`);
  away.ctx.update((s) => void (s.lastSentAt = 5));
  await proc.exited;
  expect(withStore(dir, Date.now(), (s) => s.projects["a"]?.awayUntil)).toBe(0);
});

test("two projects asking at once never get the same question id", async () => {
  const { dir, away } = server("a");
  await away.handle(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "set_away", arguments: { on: true } } }));
  const proc = await otherWriter(dir, `s.projects["b"] = { tag: "b", ownerSeen: 0, awayUntil: Date.now() + 3600000, awayStartedAt: 0, snoozeUntil: 0, questions: [{ id: "q" + s.nextQ, text: "t", options: [] }], permissions: [], outbox: [], recap: [], inbox: [], lastSentAt: 0, lastStopAt: 0 }; s.nextQ++`);
  let id = "";
  away.ctx.update((s) => void (id = `q${s.nextQ++}`));
  await proc.exited;
  const all = withStore(dir, Date.now(), (s) => Object.values(s.projects).flatMap((p) => p.questions.map((q) => q.id)));
  expect(id).toBe("q2");
  expect(new Set([...all, id]).size).toBe(all.length + 1);
});

test("the hook's StopFailure appends to an outbox entry written after its first read", async () => {
  const { dir } = server("unused");
  process.env.CLAUDE_PROJECT_DIR = dir;
  const key = projectKeyOf({});
  withStore(dir, Date.now(), (s) => void (s.projects[key] = { ...freshProject("t"), awayUntil: Date.now() + 3_600_000 }));
  const proc = await otherWriter(dir, `s.projects[${JSON.stringify(key)}].outbox.push({ type: "finished", text: "first" })`);
  const hook = Bun.spawn(["bun", join(import.meta.dir, "../plugin/hooks/hook.ts")], {
    stdin: new Blob([JSON.stringify({ hook_event_name: "StopFailure", error: "rate_limit" })]),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dir, CLAUDE_PROJECT_DIR: dir }, stdout: "ignore", stderr: "inherit",
  });
  await hook.exited;
  await proc.exited;
  const out = withStore(dir, Date.now(), (s) => s.projects[key]!.outbox.map((o) => o.text));
  expect(out).toEqual(["first", "Claude stopped: rate_limit"]);
});
