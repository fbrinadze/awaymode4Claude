import type { Json } from "./mcp.ts";
import { isAway, type State } from "./state.ts";

export interface RelayDeps {
  current(): State;
  update(fn: (s: State) => void): State;
  say(text: string): Promise<void>;
  channel(content: string, meta: Record<string, string>): void;
  now(): number;
  waitMinutes: number;
  /** Lower-cased substrings; a matching request is approved at the terminal only. */
  neverRelay: string[];
  endOfDay: "park" | "safest";
}

// Claude Code request IDs: five letters a-z without "l".
const REQUEST_ID = /^[a-km-z]{5}$/;
const HEADERS: Record<string, string> = { error: "Error", finished: "Done", info: "Update" };

export function createRelay(r: RelayDeps) {
  /** Relays a permission prompt to Teams, unless it matches never_relay. */
  async function onPermissionRequest(p: Json): Promise<void> {
    const id = String(p.request_id ?? "");
    if (!isAway(r.current(), r.now()) || !REQUEST_ID.test(id)) return;
    const shown = `${p.description ?? ""}\n${p.input_preview ?? ""}`.toLowerCase();
    if (r.neverRelay.some((pattern) => shown.includes(pattern))) {
      await r.say(`Terminal-only approval\n${p.tool_name} is waiting for approval at your terminal (it matches never_relay).`);
      return;
    }
    await r.say(`Permission needed\n${p.tool_name}: ${p.description}\n${p.input_preview}\nReply "yes ${id}" or "no ${id}".`);
    r.update((s) => void s.permissions.push({ id, tool: String(p.tool_name), at: r.now() }));
  }

  /** Sends what hooks queued (they can't reach Teams themselves). Taken in one update, so nothing is sent twice. */
  async function drainOutbox(): Promise<void> {
    let items: State["outbox"] = [];
    r.update((s) => {
      items = s.outbox;
      s.outbox = [];
    });
    for (const m of items) await r.say(`${HEADERS[m.type] ?? "Update"}\n${m.text}`);
  }

  /** Closes questions unanswered after wait_minutes and tells Claude what to do instead. */
  async function sweepTimeouts(): Promise<void> {
    const cutoff = r.now() - r.waitMinutes * 60_000;
    let late: State["questions"] = [];
    r.update((s) => {
      // Questions saved before askedAt existed never time out.
      late = s.questions.filter((q) => q.askedAt !== undefined && q.askedAt <= cutoff);
      s.questions = s.questions.filter((q) => !late.includes(q));
    });
    for (const q of late) {
      const head = `No reply from the user after ${r.waitMinutes} minutes to ${q.id} ("${q.text}").`;
      const park = r.endOfDay === "park";
      r.channel(
        park
          ? `${head} Please park this task: take no risky or irreversible steps, note where you stopped, and wait for the user.`
          : `${head} Continue with the safest option, then use notify to tell the user which option you chose.`,
        { kind: "timeout", question_id: q.id },
      );
      await r.say(
        park
          ? `No reply to ${q.id} after ${r.waitMinutes} min, so Claude parked that task. Reply any time to pick it up.`
          : `No reply to ${q.id} after ${r.waitMinutes} min, so Claude is going with the safest option and will tell you which.`,
      );
    }
  }

  return { onPermissionRequest, drainOutbox, sweepTimeouts };
}
