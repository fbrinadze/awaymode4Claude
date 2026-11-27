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

  /** Sends what hooks queued (they can't reach Teams themselves). Taken in one update so nothing is sent twice; what couldn't be sent goes back. */
  async function drainOutbox(): Promise<void> {
    if (!r.current().outbox.length) return; // no write while idle: keeps the race with hooks small
    let items: State["outbox"] = [];
    r.update((s) => {
      items = s.outbox;
      s.outbox = [];
    });
    for (let i = 0; i < items.length; i++) {
      const m = items[i]!;
      try {
        await r.say(`${HEADERS[m.type] ?? "Update"}\n${m.text}`);
      } catch (e) {
        const unsent = items.slice(i);
        r.update((s) => void (s.outbox = [...unsent, ...s.outbox]));
        throw e;
      }
    }
  }

  /** Closes questions unanswered after wait_minutes and tells Claude what to do instead. */
  async function sweepTimeouts(): Promise<void> {
    const cutoff = r.now() - r.waitMinutes * 60_000;
    // Questions saved before askedAt existed never time out.
    const overdue = (q: State["questions"][number]) => q.askedAt !== undefined && q.askedAt <= cutoff;
    if (!r.current().questions.some(overdue)) return; // no write while idle
    let late: State["questions"] = [];
    r.update((s) => {
      late = s.questions.filter(overdue);
      s.questions = s.questions.filter((q) => !late.includes(q));
    });
    const park = r.endOfDay === "park";
    // Tell Claude about every one first: that's local and can't fail, unlike Teams.
    for (const q of late) {
      const head = `No reply from the user after ${r.waitMinutes} minutes to ${q.id} ("${q.text}").`;
      r.channel(
        park
          ? `${head} Please park this task: take no risky or irreversible steps, note where you stopped, and wait for the user.`
          : `${head} Continue with the safest option, then use notify to tell the user which option you chose.`,
        { kind: "timeout", question_id: q.id },
      );
    }
    for (const q of late) {
      await r.say(
        park
          ? `No reply to ${q.id} after ${r.waitMinutes} min, so Claude parked that task. Reply any time to pick it up.`
          : `No reply to ${q.id} after ${r.waitMinutes} min, so Claude is going with the safest option and will tell you which.`,
      );
    }
  }

  return { onPermissionRequest, drainOutbox, sweepTimeouts };
}
