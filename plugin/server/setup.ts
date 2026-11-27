import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "./adapters/adapter.ts";
import { saveTeams, teamsAdapter, type TeamsConfig } from "./adapters/teams.ts";
import type { Auth, DeviceCode } from "./auth.ts";
import { bearer, call, type Json, type Net } from "./http.ts";
import type { Tool } from "./mcp.ts";
import type { Ctx } from "./tools.ts";
import { consentHelp, finishWorkflow } from "./setup-workflow.ts";

export interface SetupDeps {
  ctx: Ctx;
  dir: string;
  net: Net;
  /** null when the route's sign-in settings aren't set. */
  auth: Auth | null;
  tenantId: string;
  botId: string;
  /** The adapter in use now, and a way to switch to Teams once paired. */
  current(): Adapter;
  use(adapter: Adapter): void;
  /** Set on the workflow route: pairing goes through the flow instead of the bot. */
  workflow?: { url: string; ref: string };
  /** Which Teams route the settings chose; decides which missing settings setup names. */
  route?: "bot" | "workflow";
}

const GRAPH = "https://graph.microsoft.com/v1.0";
const NOT_CONFIGURED =
  "Away Mode's Tenant ID, Bot app ID and Bot secret aren't set. Enter them in the plugin's settings (/plugin), restart Claude Code with the channel on, then run setup again.";
const WORKFLOW_NOT_CONFIGURED =
  "Away Mode's workflow route isn't fully set up: the workflow URL or the sign-in app is missing. Rerun setup\\install.ps1 -Route workflow, restart Claude Code with the channel on, then run setup again.";
const NOT_ADDED =
  "The Away Mode app isn't added in Teams yet. In Teams open Apps > Manage your apps > Upload a custom app and pick away-mode-teams.zip (or Add it from your organization's apps). Then call setup with step \"finish\" again.";
const DESCRIPTION =
  'Connect Away Mode to Microsoft Teams, in order: "start" (returns a sign-in code to show the user), "finish" (after they sign in: finds the chat and sends a test message), "verify" (after they reply hi). "cancel" removes a saved sign-in.';

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

/** Bot route: finds the bot chat, switches to Teams and sends a test message. */
async function finishBot(d: SetupDeps, auth: Auth): Promise<string> {
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

async function verify(d: SetupDeps): Promise<string> {
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

/** The sign-in to use, or the route's own explanation of which settings are missing. */
function ready(d: SetupDeps): Auth {
  if (d.route === "workflow" && (!d.auth || !d.workflow)) throw new Error(WORKFLOW_NOT_CONFIGURED);
  if (!d.auth) throw new Error(NOT_CONFIGURED);
  return d.auth;
}

export function setupTool(d: SetupDeps): Tool {
  let pending: DeviceCode | null = null;

  /** Completes a pending sign-in, here or saved by an earlier session. A consent refusal is explained. */
  async function signIn(auth: Auth): Promise<void> {
    const dc = pending ?? takePending(d.dir, d.ctx.deps.now());
    pending = null;
    if (dc) await auth.finishDeviceCode(dc).catch((e) => { throw consentHelp(e) ?? e; });
  }

  return {
    name: "setup",
    description: DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        step: { type: "string", enum: ["start", "finish", "verify", "cancel"] },
        accept_scopes: { type: "boolean", description: "Workflow route only: the user read the sign-in warning and wants to continue." },
      },
      required: ["step"],
    },
    async run(a) {
      const auth = ready(d);
      if (a.step === "start") {
        pending = await auth.startDeviceCode();
        savePending(d.dir, pending);
        return `Show the user this exactly: ${pending.message}\nWhen they say they've signed in, call setup with step "finish".`;
      }
      if (a.step === "cancel") return auth.signOut().then(() => "The saved Microsoft sign-in was removed. Run setup again when you're ready.");
      if (a.step === "verify") return verify(d);
      if (a.step !== "finish") throw new Error('step must be "start", "finish", "verify" or "cancel".');
      await signIn(auth);
      return d.workflow ? finishWorkflow(d, auth, d.workflow, a.accept_scopes === true) : finishBot(d, auth);
    },
  };
}
