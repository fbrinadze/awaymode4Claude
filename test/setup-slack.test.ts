import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Msg } from "../plugin/server/adapters/adapter.ts";
import { fresh, type State } from "../plugin/server/state.ts";
import { loadSlack, pickPlatform, setupSlackTool } from "../plugin/server/setup-slack.ts";

const T = Date.parse("2026-11-26T18:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "away-slack-"));
  let now = T;
  const state: State = fresh();
  const dms: Msg[] = [];
  const sent: { to: string; text: string }[] = [];
  const paired: string[] = [];
  const tool = setupSlackTool({
    ctx: {
      deps: { hours: 9, now: () => now },
      current: () => state,
      update: (fn) => (fn(state), state),
      say: async () => {},
      startPolling: () => {},
    },
    dir,
    readDms: async () => dms,
    send: async (to, text) => void sent.push({ to, text }),
    use: (me) => void paired.push(me),
  });
  const run = (step: string) => tool.run({ step }) as Promise<string>;
  const dm = (text: string, from = "U1", at = now + 1000) => dms.push({ id: `${dms.length}`, from, text, at: iso(at) });
  return { dir, run, dm, sent, paired, tick: (ms: number) => (now += ms), state };
}
const codeOf = (text: string) => /\d{6}/.exec(text)![0];

test("start returns a 6-digit code", async () => {
  const h = harness();
  expect(await h.run("start")).toMatch(/DM the Away Mode bot in Slack with this code: \d{6}\b/);
});

test("the right code pairs: sets me, saves slack.json (only me), replies Paired to the sender", async () => {
  const h = harness();
  const code = codeOf(await h.run("start"));
  h.dm(code, "U42");
  expect(await h.run("finish")).toContain("Paired");
  expect(h.state.me).toBe("U42");
  expect(h.paired).toEqual(["U42"]);
  expect(h.sent).toEqual([{ to: "U42", text: "Paired" }]);
  const file = join(h.dir, "slack.json");
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ me: "U42" });
  expect(loadSlack(h.dir)).toEqual({ me: "U42" });
  // POSIX permission bits don't exist on Windows; NTFS ignores the mode.
  if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
});

test("a wrong code does not pair", async () => {
  const h = harness();
  const code = codeOf(await h.run("start"));
  h.dm(code === "000000" ? "111111" : "000000", "U42");
  expect(await h.run("finish")).toContain("didn't see");
  expect(h.state.me).toBe("");
  expect(h.paired).toEqual([]);
  expect(h.sent).toEqual([]);
});

test("an expired code does not pair", async () => {
  const h = harness();
  const code = codeOf(await h.run("start"));
  h.dm(code, "U42", T + 11 * 60_000);
  h.tick(11 * 60_000);
  expect(await h.run("finish")).toContain("expired");
  expect(h.state.me).toBe("");
});

test("a DM sent before start does not pair", async () => {
  const h = harness();
  const code = codeOf(await h.run("start"));
  h.dm(code, "U42", T - 1000);
  expect(await h.run("finish")).toContain("didn't see");
  expect(h.state.me).toBe("");
});

test("the code is single-use", async () => {
  const h = harness();
  const code = codeOf(await h.run("start"));
  h.dm(code, "U42");
  await h.run("finish");
  h.dm(code, "U99");
  expect(await h.run("finish")).toContain("start");
  expect(h.state.me).toBe("U42");
});

test("pickPlatform chooses Slack only when both tokens are set", () => {
  expect(pickPlatform({ AWAY_SLACK_BOT_TOKEN: "xoxb-test", AWAY_SLACK_APP_TOKEN: "xapp-test" })).toBe("slack");
  expect(pickPlatform({ AWAY_SLACK_BOT_TOKEN: "xoxb-test" })).toBe("teams");
  expect(pickPlatform({ AWAY_SLACK_APP_TOKEN: "xapp-test" })).toBe("teams");
  expect(pickPlatform({ AWAY_SLACK_BOT_TOKEN: "xoxb-test", AWAY_SLACK_APP_TOKEN: "${user_config.slack_app_token}" })).toBe("teams");
  expect(pickPlatform({})).toBe("teams");
});
