// Pairing on the workflow route: send a code through the flow, then find the chat it landed in.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCard } from "./adapters/card.ts";
import { botText, type GraphMsg } from "./adapters/graph-chat.ts";
import { postCard, type WorkflowConfig } from "./adapters/workflow.ts";
import type { Auth } from "./auth.ts";
import { bearer, call, HttpError, type Json, type Net } from "./http.ts";
import { extraScopes, grantedScopes } from "./scopes.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const TRIES = 12;
const WAIT_MS = 5_000;
const NOT_ARRIVED =
  "The pairing card didn't arrive. In Power Automate check the Away Mode flow is on and posts to Chat with Flow bot with you as the recipient.";

/** Plain words for a sign-in token that can do more than read chats; undefined when it's narrow. */
export async function scopeWarning(auth: Auth): Promise<string | undefined> {
  const extra = extraScopes(grantedScopes(await auth.graphToken()));
  if (!extra.length) return undefined;
  return `This sign-in can also use: ${extra.join(", ")}. That's more than Away Mode needs (it only reads your chat). ` +
    "If you can, use your own app registration instead (rerun setup\\install.ps1 without -SignInApp graph-tools).";
}

/** A sign-in refused for lack of consent, explained; undefined for any other error. */
export function consentHelp(e: unknown): Error | undefined {
  if (!(e instanceof HttpError)) return undefined;
  const text = `${e.body.error ?? ""} ${e.body.error_description ?? ""}`;
  if (!/consent_required|AADSTS65001|AADSTS90094/.test(text)) return undefined;
  return new Error("Your organisation needs an admin to approve Away Mode's sign-in (Chat.Read). " +
    "If Microsoft's Graph tools app is already approved there, rerun the installer with -SignInApp graph-tools.");
}

export interface PairOptions {
  dir: string;
  net: Net;
  auth: Auth;
  url: string;
  ref: string;
  tenantId: string;
  sleep(ms: number): Promise<void>;
  /** Fixed in tests; random otherwise. */
  code?: string;
}

/** The chat holding an app message with both the code and our ref, or undefined. */
async function findChat(o: PairOptions, token: string, code: string): Promise<string | undefined> {
  const chats = await call(o.net, `${GRAPH}/me/chats?$top=20`, bearer(token));
  for (const c of (chats.value ?? []) as Json[]) {
    const id = String(c.id);
    const msgs = await call(o.net, `${GRAPH}/chats/${encodeURIComponent(id)}/messages?$top=10`, bearer(token));
    const hit = ((msgs.value ?? []) as GraphMsg[]).some((m) => {
      const t = m.from?.application ? botText(m) : "";
      return t.includes(code) && t.includes(`ref ${o.ref}`);
    });
    if (hit) return id;
  }
  return undefined;
}

export async function pairWorkflow(o: PairOptions): Promise<WorkflowConfig> {
  const code = o.code ?? crypto.randomUUID().slice(0, 6).toUpperCase();
  const text = `Pairing code ${code}\nAway Mode is connected to your Claude Code session. Reply hi to finish pairing.`;
  await postCard(o.url, buildCard(text, { kind: "setup" }, o.ref), o.net);
  const token = await o.auth.graphToken();
  for (let i = 0; i < TRIES; i++) {
    const chatId = await findChat(o, token, code);
    if (chatId) {
      const me = String((await call(o.net, `${GRAPH}/me?$select=id`, bearer(token))).id);
      const cfg: WorkflowConfig = { route: "workflow", tenantId: o.tenantId, chatId, me };
      mkdirSync(o.dir, { recursive: true });
      writeFileSync(join(o.dir, "teams.json"), JSON.stringify(cfg, null, 2), { mode: 0o600 });
      return cfg;
    }
    await o.sleep(WAIT_MS);
  }
  throw new Error(NOT_ARRIVED);
}
