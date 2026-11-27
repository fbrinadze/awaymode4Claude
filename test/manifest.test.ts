import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => JSON.parse(readFileSync(new URL(`../plugin/${p}`, import.meta.url), "utf8"));
const BUN = "bun";

// install.ps1 links bun.exe into WindowsApps (always on PATH), so a bare "bun" resolves.
test("server and every hook run plain bun, with no bun_path setting", () => {
  const plugin = read(".claude-plugin/plugin.json");
  expect(plugin.mcpServers.away.command).toBe(BUN);
  expect(plugin.userConfig.bun_path).toBeUndefined();

  const commands = Object.values(read("hooks/hooks.json").hooks as Record<string, { hooks: { command: string }[] }[]>)
    .flat()
    .flatMap((m) => m.hooks.map((h) => h.command));
  expect(commands.length).toBeGreaterThan(0);
  for (const c of commands) expect(c).toBe(BUN);
});

test("install.ps1 refreshes a stale bun link and tells the user what to do when it is locked", () => {
  const ps = readFileSync(new URL("../setup/install.ps1", import.meta.url), "utf8");
  expect(ps).toContain("$cur.LastWriteTime -ne $real.LastWriteTime");
  expect(ps).toContain("Remove-Item $bunLink -Force -ErrorAction Stop");
  expect(ps).toMatch(/close Claude Code and (run|rerun) this script/i);
});

test("listing metadata: https urls, icon, plugin README and LICENSE, size limits", () => {
  const plugin = read(".claude-plugin/plugin.json");
  for (const k of ["documentationUrl", "supportUrl", "privacyPolicyUrl"]) expect(plugin[k]).toMatch(/^https:\/\//);
  expect(existsSync(new URL(`../plugin/${plugin.icon}`, import.meta.url))).toBe(true);
  const readme = readFileSync(new URL("../plugin/README.md", import.meta.url), "utf8");
  expect(readme.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
  expect(existsSync(new URL("../plugin/LICENSE", import.meta.url))).toBe(true);

  const root = new URL("../plugin", import.meta.url);
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
  expect(files.length).toBeLessThanOrEqual(512);
  for (const f of files) expect(statSync(join(f.parentPath, f.name)).size).toBeLessThanOrEqual(256 * 1024);
});

test("manifest declares the three route settings in userConfig and env, workflow_url sensitive", () => {
  const plugin = read(".claude-plugin/plugin.json");
  expect(plugin.userConfig.teams_route).toMatchObject({ type: "string", default: "bot" });
  expect(plugin.userConfig.workflow_url).toMatchObject({ type: "string", sensitive: true });
  expect(plugin.userConfig.sign_in_app).toMatchObject({ type: "string" });
  expect(plugin.mcpServers.away.env.AWAY_TEAMS_ROUTE).toBe("${user_config.teams_route}");
  expect(plugin.mcpServers.away.env.AWAY_WORKFLOW_URL).toBe("${user_config.workflow_url}");
  expect(plugin.mcpServers.away.env.AWAY_SIGN_IN_APP).toBe("${user_config.sign_in_app}");
});

test("sessions and reply_routing settings default safely and reach the server as env vars", () => {
  const plugin = read(".claude-plugin/plugin.json");
  expect(plugin.userConfig.sessions).toMatchObject({ type: "string", default: "several" });
  expect(plugin.userConfig.reply_routing).toMatchObject({ type: "string", default: "off" });
  expect(plugin.mcpServers.away.env.AWAY_SESSIONS).toBe("${user_config.sessions}");
  expect(plugin.mcpServers.away.env.AWAY_REPLY_ROUTING).toBe("${user_config.reply_routing}");
});

const setupText = (f: string) => readFileSync(new URL(`../setup/${f}`, import.meta.url), "utf8");

test("install.ps1 has -Route with bot and workflow", () => {
  const ps = setupText("install.ps1");
  expect(ps).toContain('[ValidateSet("bot", "workflow")][string]$Route');
  expect(ps).toContain("[string]$SignInApp");
  expect(ps).toContain("--allow-no-subscriptions");
  expect(ps).toContain("may carry more permissions than Away Mode needs");
});

test("create-app has a workflow mode without a secret", () => {
  const ps = setupText("create-app.ps1");
  expect(ps).toContain('[ValidateSet("bot", "workflow")][string]$Mode');
  expect(ps).toContain("e1fe6dd8-ba31-4d61-89e7-88639da4683d");
  expect(ps).toContain("f501c180-9344-439a-bca0-6cbf209fd270");
  expect(setupText("create-app.sh")).toContain("--workflow");
});

test("URL prompt is AsSecureString and never goes on a command line", () => {
  const ps = setupText("install.ps1");
  expect(ps).toContain("Read-Host");
  expect(ps).toContain("-AsSecureString");
  expect(ps).toContain("workflow_url");
  expect(ps).not.toMatch(/Write-Host[^\n]*\$workflowUrl/);
});
