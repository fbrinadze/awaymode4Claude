import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "./adapters/adapter.ts";
import { loadTeams } from "./adapters/teams.ts";
import type { Auth } from "./auth.ts";
import { bearer, call, HttpError, type Net } from "./http.ts";
import type { Tool } from "./mcp.ts";
import { readStore } from "./store.ts";

export interface DoctorDeps {
  dir: string;
  net: Net;
  /** null when Tenant ID, Bot app ID or Bot secret isn't set. */
  auth: Auth | null;
  tenantId: string;
  botId: string;
  /** Only whether the secret is set; its value never reaches this file. */
  hasSecret: boolean;
  now(): number;
  version: string;
  bunVersion: string;
  current(): Adapter;
}

type Check = string | null; // null = fine, otherwise the fix
const line = (name: string, fix: Check, ok = name) => (fix === null ? `✔ ${ok}` : `✘ ${name}: ${fix}`);
const SETUP = "run /away-mode:setup";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function settings(d: DoctorDeps): string {
  const missing = [!d.tenantId && "tenant", !d.botId && "bot ID", !d.hasSecret && "secret"].filter(Boolean);
  if (missing.length) return line("settings", "run setup\\install.ps1 or set them under /plugin");
  return line("settings", null, "settings (tenant, bot ID and secret are set)");
}

/** Sign-in and /me together: a 401 from Graph means the saved sign-in is dead. */
async function graph(d: DoctorDeps): Promise<string[]> {
  if (!d.auth) return [line("sign-in", "set the three settings first, then " + SETUP), line("Graph /me", "needs sign-in first")];
  let token: string;
  try {
    token = await d.auth.graphToken();
  } catch {
    return [line("sign-in", SETUP), line("Graph /me", "needs sign-in first")];
  }
  try {
    await call(d.net, "https://graph.microsoft.com/v1.0/me?$select=id", bearer(token));
    return [line("sign-in", null, "sign-in (token obtained)"), line("Graph /me", null, "Graph /me reachable")];
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) return [line("sign-in", SETUP), line("Graph /me", "401 from Graph")];
    return [line("sign-in", null, "sign-in (token obtained)"), line("Graph /me", `${msg(e)}; check the network or Microsoft 365 status`)];
  }
}

function pairing(d: DoctorDeps): string {
  const teams = loadTeams(d.dir);
  if (!teams) return line("bot chat and pairing", `teams.json not found; ${SETUP}`);
  if (!teams.chatId) return line("bot chat and pairing", `no bot chat saved; ${SETUP}`);
  if (!readStore(d.dir, d.now()).me) return line("bot chat and pairing", `not paired (no reply seen yet); ${SETUP}`);
  return line("bot chat and pairing", null, "bot chat found and paired");
}

function stateFile(d: DoctorDeps): string {
  const path = join(d.dir, "state.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return line("state.json", null, "state.json (not created yet; it appears when away mode is first used)");
  }
  try {
    if ((JSON.parse(raw) as { version?: number }).version !== 2) return line("state.json", "old format; it converts the next time away mode starts");
  } catch {
    return line("state.json", "not valid JSON; delete it, or ask for help");
  }
  if (process.platform !== "win32" && (statSync(path).mode & 0o777) !== 0o600) {
    return line("state.json", `permissions should be 0600; run chmod 600 "${path}"`);
  }
  return line("state.json", null, "state.json (readable, version 2)");
}

const clock = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

function leaseAndProjects(d: DoctorDeps): string[] {
  const s = readStore(d.dir, d.now());
  const lease = s.lease && s.lease.until > d.now() ? `held by ${s.lease.owner}, until ${clock(s.lease.until)}` : "none";
  const away = Object.values(s.projects).filter((p) => p.awayUntil > d.now());
  const projects = away.length ? away.map((p) => `@${p.tag} until ${clock(p.awayUntil)}`).join(", ") : "none";
  return [line("poll lease", null, `poll lease: ${lease}`), line("away projects", null, `away projects: ${projects}`)];
}

async function sendTest(d: DoctorDeps): Promise<string> {
  try {
    await d.current().send("Away Mode doctor: test message. If you can read this in Teams, sending works.");
    return line("test message", null, "test message sent; check Teams");
  } catch (e) {
    return line("test message", msg(e));
  }
}

export function doctorTool(d: DoctorDeps): Tool {
  return {
    name: "doctor",
    description:
      "Check Away Mode's setup and report one line per check with a fix for each failure. Works before setup. Pass send_test: true (only after the user agrees) to also send one test message to Teams.",
    inputSchema: { type: "object", properties: { send_test: { type: "boolean" } } },
    async run(a) {
      const out = [
        line("Bun", null, `Bun ${d.bunVersion}`),
        line("plugin version", null, `plugin version ${d.version}`),
        settings(d),
        ...(await graph(d)),
        pairing(d),
        stateFile(d),
        ...leaseAndProjects(d),
      ];
      if (a.send_test === true) out.push(await sendTest(d));
      return out.join("\n");
    },
  };
}
