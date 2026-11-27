// The no-admin route: a Power Automate workflow posts cards as the Flow bot; Graph reads replies.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Net } from "../http.ts";
import type { Adapter } from "./adapter.ts";
import { buildCard, cardMessage } from "./card.ts";
import { graphChat } from "./graph-chat.ts";

/** Saved by setup in teams.json; bot-route configs have no `route`. */
export interface WorkflowConfig {
  route: "workflow";
  tenantId: string;
  chatId: string;
  me: string;
}

/**
 * The workflow URL is a password: anyone holding it can post into the user's chat. Errors carry
 * only the status, never the URL, the response body or the underlying error text.
 */
export async function postCard(url: string, card: object, net: Net): Promise<void> {
  let status: number;
  try {
    const r = await net.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cardMessage(card)) });
    status = r.status;
  } catch {
    throw new Error("Couldn't reach the Away Mode workflow.");
  }
  if (status < 200 || status > 299) {
    throw new Error(`The Away Mode workflow didn't accept the message (HTTP ${status}). Check the flow is turned on in Power Automate.`);
  }
}

/** This install's ref: printed on every card so other flows' look-alike cards are never taken as ours. */
export function installRef(dir: string): string {
  const file = join(dir, "ref.txt");
  try {
    const saved = readFileSync(file, "utf8").trim();
    if (/^[a-z0-9]{8}$/.test(saved)) return saved;
  } catch {
    // none yet: make one below
  }
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const ref = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => abc[b % abc.length]).join("");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, ref, { mode: 0o600 });
  return ref;
}

export function workflowAdapter(cfg: WorkflowConfig, url: string, ref: string, token: () => Promise<string>, net: Net): Adapter {
  const reader = graphChat({ chatId: cfg.chatId, token, net, ours: (t) => t.includes(`ref ${ref}`) });
  return {
    send: (text, meta) => postCard(url, buildCard(text, meta, ref), net),
    poll: (since) => reader.poll(since),
    me: async () => cfg.me,
  };
}
