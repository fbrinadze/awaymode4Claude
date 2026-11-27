import type { Kind } from "./adapters/adapter.ts";
import type { Json } from "./mcp.ts";
import { redact } from "./sensitive.ts";
import { isAway, type State } from "./state.ts";
import { KIND_OF } from "./tools.ts";

export interface RelayDeps {
  /** Tags each new permission, so only this server delivers its verdict. */
  instance: string;
  current(): State;
  update(fn: (s: State) => void): State;
  say(text: string, kind?: Kind): Promise<void>;
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
// Sized so the whole prompt, reply line included, fits the 1200-character Teams message cap.
const TOOL_MAX = 100;
const DESC_MAX = 300;
const PREVIEW_MAX = 600;

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Canonical form of a command for never_relay matching, applied to both the request text and
 * each pattern, so spacing, quoting and flag order can't sneak a protected command past it.
 */
export function normalise(text: string): string {
  // Each run of flags becomes one sorted short-flag cluster, then its long flags:
  // "-rf", "-fr", "-r -f" and "--no-preserve-root -rf" all start with "-fr".
  const out: string[] = [];
  let shorts = new Set<string>();
  let longs: string[] = [];
  const flush = () => {
    if (shorts.size) out.push(`-${[...shorts].sort().join("")}`);
    out.push(...longs.sort());
    shorts = new Set();
    longs = [];
  };
  for (const word of text.toLowerCase().replace(/["'`]/g, "").split(/\s+/).filter(Boolean)) {
    if (/^-[a-z0-9]+$/.test(word)) for (const c of word.slice(1)) shorts.add(c);
    else if (/^--[a-z0-9-]+$/.test(word)) longs.push(word);
    else {
      flush();
      out.push(word);
    }
  }
  flush();
  return out.join(" ");
}

export function createRelay(r: RelayDeps) {
  const terminalOnly = (tool: string, why: string) =>
    r.say(`Terminal-only approval\n${tool} is waiting for approval at your terminal (it ${why}).`, "approval");

  /** Relays a permission prompt to Teams, unless it matches never_relay. */
  async function onPermissionRequest(p: Json): Promise<void> {
    const id = String(p.request_id ?? "");
    if (!isAway(r.current(), r.now()) || !REQUEST_ID.test(id)) return;
    const tool = clip(String(p.tool_name ?? ""), TOOL_MAX);
    const raw = String(p.input_preview ?? "");
    const shown = normalise(`${tool}\n${p.description ?? ""}\n${raw}`);
    if (r.neverRelay.some((pattern) => shown.includes(normalise(pattern)))) return terminalOnly(tool, "matches never_relay");
    const preview = redact(raw);
    // A long command is approvable only after `more <id>` has sent all of it.
    const needsMore = preview.length > PREVIEW_MAX;
    const description = clip(String(p.description ?? ""), DESC_MAX);
    const body = needsMore ? `Too long to show here: reply more ${id} to read it` : preview;
    await r.say(`Permission needed\n${tool}: ${description}\n${body}\nReply "yes ${id}" or "no ${id}".`, "approval");
    r.update((s) => void s.permissions.push({ id, tool, at: r.now(), instance: r.instance, preview, ...(needsMore && { needsMore }) }));
  }

  /** Sends what hooks queued (they can't reach Teams themselves). Taken in one update so nothing is sent twice; what couldn't be sent goes back. */
  async function drainOutbox(): Promise<void> {
    if (!r.current().outbox.length) return; // no write while idle: keeps the race with hooks small
    let items: State["outbox"] = [];
    r.update((s) => {
      items = s.outbox;
      s.outbox = [];
      if (s.snoozeUntil > r.now()) { // snoozed: finished/info wait for the recap, errors still go out
        const held = items.filter((m) => m.type === "finished" || m.type === "info");
        for (const m of held) s.recap.push({ kind: m.type as "finished" | "info", text: m.text });
        items = items.filter((m) => !held.includes(m));
      }
    });
    for (let i = 0; i < items.length; i++) {
      const m = items[i]!;
      try {
        await r.say(`${HEADERS[m.type] ?? "Update"}\n${m.text}`, KIND_OF[m.type] ?? "update");
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
      if (r.endOfDay === "park") for (const q of late) s.recap.push({ kind: "parked", text: `${q.id}: ${q.text}` });
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
