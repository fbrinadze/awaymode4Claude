import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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
