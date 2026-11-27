import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DoctorDeps } from "./doctor.ts";
import { extraScopes, grantedScopes } from "./scopes.ts";

const SETUP = "run /away-mode:setup";

/** The checks that only exist on the workflow route. The workflow URL is a password: only whether it's set is ever shown. */
export async function workflowLines(d: DoctorDeps): Promise<string[]> {
  return [
    "✔ route: workflow",
    d.workflowUrlSet ? "✔ workflow URL set" : `✘ workflow URL: not set; ${SETUP}`,
    await scopeLine(d),
    pairedLine(d),
  ];
}

async function scopeLine(d: DoctorDeps): Promise<string> {
  if (!d.auth) return `✘ sign-in scopes: sign-in app not set; ${SETUP}`;
  let token: string;
  try {
    token = await d.auth.graphToken();
  } catch {
    return `✘ sign-in scopes: not signed in; ${SETUP}`;
  }
  const extra = extraScopes(grantedScopes(token));
  return extra.length
    ? `✘ sign-in scopes: broader than needed (${extra.join(", ")}); use a sign-in app limited to chat read access`
    : "✔ sign-in scopes (only what Away Mode needs)";
}

function pairedLine(d: DoctorDeps): string {
  let saved: { route?: string; chatId?: string } = {};
  try {
    saved = JSON.parse(readFileSync(join(d.dir, "teams.json"), "utf8")) as typeof saved;
  } catch {
    return `✘ paired: no saved chat yet; ${SETUP}`; // teams.json missing or unreadable: not paired
  }
  return saved.route === "workflow" && saved.chatId ? "✔ paired" : `✘ paired: not paired on the workflow route; ${SETUP}`;
}
