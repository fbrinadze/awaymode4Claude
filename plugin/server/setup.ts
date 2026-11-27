import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "./adapters/adapter.ts";
import { saveTeams, teamsAdapter, type TeamsConfig } from "./adapters/teams.ts";
import type { Auth, DeviceCode } from "./auth.ts";
import { bearer, call, type Json, type Net } from "./http.ts";
import type { Tool } from "./mcp.ts";
import type { Ctx } from "./tools.ts";

export interface SetupDeps {
  ctx: Ctx;
  dir: string;
  net: Net;
  /** null when Tenant ID, Bot app ID or Bot secret isn't set. */
  auth: Auth | null;
  tenantId: string;
  botId: string;
  /** The adapter in use now, and a way to switch to Teams once paired. */
  current(): Adapter;
  use(adapter: Adapter): void;
}

const GRAPH = "https://graph.microsoft.com/v1.0";
const NOT_CONFIGURED =
  "Away Mode's Tenant ID, Bot app ID and Bot secret aren't set. Enter them in the plugin's settings (/plugin), restart Claude Code with the channel on, then run setup again.";
const NOT_ADDED =
  "The Away Mode app isn't added in Teams yet. In Teams open Apps > Manage your apps > Upload a custom app and pick away-mode-teams.zip (or Add it from your organization's apps). Then call setup with step \"finish\" again.";

// ponytail: the device code is a short-lived credential (about 15 min). It's kept 0600 in plugin
// data only so a closed terminal doesn't lose pairing, and it's deleted the moment it's read.
const deviceFile = (dir: string) => join(dir, "device.json");

function savePending(dir: string, dc: DeviceCode): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(deviceFile(dir), JSON.stringify(dc), { mode: 0o600 });
}

/** The saved code, if still valid. Always removes the file: a code is only ever used once. */
function takePending(dir: string, now: number): DeviceCode | null {
  try {
    const dc = JSON.parse(readFileSync(deviceFile(dir), "utf8")) as DeviceCode;
    return dc.expiresAt > now ? dc : null;
  } catch {
    return null;
  } finally {
    rmSync(deviceFile(dir), { force: true });
  }
}

export function setupTool(d: SetupDeps): Tool {
  let pending: DeviceCode | null = null;

  async function start(auth: Auth): Promise<string> {
    pending = await auth.startDeviceCode();
    savePending(d.dir, pending);
    return `Show the user this exactly: ${pending.message}\nWhen they say they've signed in, call setup with step "finish".`;
  }

  /** Signs in (if a code is pending, here or saved by an earlier session), finds the bot chat, switches to Teams and sends a test message. */
  async function finish(auth: Auth): Promise<string> {
    const saved = takePending(d.dir, d.ctx.deps.now());
    const dc = pending ?? saved;
    pending = null;
    if (dc) await auth.finishDeviceCode(dc);
    const token = await auth.graphToken();
    const me = String((await call(d.net, `${GRAPH}/me?$select=id`, bearer(token))).id);
    const apps = await call(d.net, `${GRAPH}/users/${me}/teamwork/installedApps?$expand=teamsApp`, bearer(token));
    // Org-catalog apps carry the manifest ID in externalId; uploaded (sideloaded) apps carry it in id.
    const app = ((apps.value ?? []) as Json[]).find((a) => {
      const t = a.teamsApp as Json | undefined;
      return t?.externalId === d.botId || t?.id === d.botId;
    });
    if (!app) throw new Error(NOT_ADDED);
    const chat = await call(d.net, `${GRAPH}/users/${me}/teamwork/installedApps/${app.id}/chat`, bearer(token));

    const cfg: TeamsConfig = { tenantId: d.tenantId, botId: d.botId, chatId: String(chat.id), me };
    saveTeams(d.dir, cfg);
    d.use(teamsAdapter(d.dir, cfg, auth, d.net));
    const now = d.ctx.deps.now();
    d.ctx.update((s) => {
      s.me = me;
      s.cursor = new Date(now).toISOString();
    });
    await d.ctx.say("Away Mode is connected to your Claude Code session. Reply hi to finish pairing.", "setup");
    return 'Test message sent in Teams. Ask the user to reply "hi" in the Away Mode chat, then call setup with step "verify".';
  }

  async function verify(): Promise<string> {
    const s = d.ctx.current();
    if (!s.me) throw new Error('Not signed in yet. Call setup with step "start".');
    const msgs = await d.current().poll(s.cursor);
    const last = msgs.at(-1);
    if (last) d.ctx.update((x) => void (x.cursor = last.at));
    if (!msgs.some((m) => m.from === s.me)) {
      return 'No reply yet. Ask the user to reply "hi" in the Away Mode chat in Teams, then call setup with step "verify" again.';
    }
    await d.ctx.say("Paired. While you're away, Claude's questions will come here.", "setup");
    return 'Paired. Away Mode is ready. Tell the user to say when they step away (for example "going to lunch, back at 1:30").';
  }

  return {
    name: "setup",
    description:
      'Connect Away Mode to Microsoft Teams, in order: "start" (returns a sign-in code to show the user), "finish" (after they sign in: finds the bot chat and sends a test message), "verify" (after they reply hi).',
    inputSchema: {
      type: "object",
      properties: { step: { type: "string", enum: ["start", "finish", "verify"] } },
      required: ["step"],
    },
    async run(a) {
      if (!d.auth) throw new Error(NOT_CONFIGURED);
      if (a.step === "start") return start(d.auth);
      if (a.step === "finish") return finish(d.auth);
      if (a.step === "verify") return verify();
      throw new Error('step must be "start", "finish" or "verify".');
    },
  };
}
