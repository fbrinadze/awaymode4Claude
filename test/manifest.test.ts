import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => JSON.parse(readFileSync(new URL(`../plugin/${p}`, import.meta.url), "utf8"));
const BUN = "${user_config.bun_path}";

// A bare "bun" fails when Claude Code started before Bun reached PATH (common on Windows).
test("server and every hook run bun through the bun_path setting", () => {
  const plugin = read(".claude-plugin/plugin.json");
  expect(plugin.mcpServers.away.command).toBe(BUN);
  expect(plugin.userConfig.bun_path.default).toBe("bun");

  const commands = Object.values(read("hooks/hooks.json").hooks as Record<string, { hooks: { command: string }[] }[]>)
    .flat()
    .flatMap((m) => m.hooks.map((h) => h.command));
  expect(commands.length).toBeGreaterThan(0);
  for (const c of commands) expect(c).toBe(BUN);
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
