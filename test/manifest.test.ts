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

test("sessions and reply_routing settings default safely and reach the server as env vars", () => {
  const plugin = read(".claude-plugin/plugin.json");
  expect(plugin.userConfig.sessions).toMatchObject({ type: "string", default: "several" });
  expect(plugin.userConfig.reply_routing).toMatchObject({ type: "string", default: "off" });
  expect(plugin.mcpServers.away.env.AWAY_SESSIONS).toBe("${user_config.sessions}");
  expect(plugin.mcpServers.away.env.AWAY_REPLY_ROUTING).toBe("${user_config.reply_routing}");
});
