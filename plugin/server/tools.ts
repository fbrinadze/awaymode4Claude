import type { Json, Tool } from "./mcp.ts";
import { isAway, type State } from "./state.ts";

export interface Ctx {
  deps: { hours: number; now(): number };
  current(): State;
  update(fn: (s: State) => void): State;
  say(text: string): Promise<void>;
  startPolling(): void;
}

const HEADERS: Record<string, string> = { finished: "Done", error: "Error", info: "Update" };

function text(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required.`);
  return v.trim();
}

function requireAway(c: Ctx): void {
  if (!isAway(c.current(), c.deps.now())) throw new Error("Away mode is off. Ask in the terminal instead.");
}

const obj = (properties: Json, required: string[]): Json => ({ type: "object", properties, required });

const CLOCK = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;

/**
 * End time in epoch ms, from the server's own clock and timezone. Claude knows the date but not
 * the time, so "for 30 minutes" and "back at 1:30" are resolved here. NaN means unusable.
 */
export function resolveUntil(a: Json, now: number, hours: number): number {
  if (typeof a.minutes === "number") return a.minutes > 0 ? now + a.minutes * 60_000 : NaN;
  if (typeof a.at === "string") {
    const m = CLOCK.exec(a.at.trim());
    if (!m) return NaN;
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const ampm = m[3]?.toLowerCase();
    if (ampm) h = (h % 12) + (ampm === "pm" ? 12 : 0);
    if (h > 23 || min > 59) return NaN;
    const d = new Date(now);
    d.setHours(h, min, 0, 0);
    // The next time the clock shows it: "back at 1:30" said at 2 PM means tomorrow.
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  if (a.until !== undefined) return Date.parse(String(a.until));
  return now + hours * 3_600_000;
}

export function makeTools(c: Ctx): Tool[] {
  const ask: Tool = {
    name: "ask",
    description: "Ask the away user a question in Teams. Returns at once; the answer arrives later as a channel event with kind=answer and this question_id.",
    inputSchema: obj({ question: { type: "string" }, options: { type: "array", items: { type: "string" } } }, ["question"]),
    async run(a) {
      requireAway(c);
      const question = text(a.question, "question");
      const options = Array.isArray(a.options) ? a.options.map(String) : [];
      let id = "";
      c.update((s) => {
        id = `q${s.nextQ++}`;
        s.questions.push({ id, text: question, options });
      });
      const how = options.length
        ? `Reply ${options.map((o, i) => `${i + 1} = ${o}`).join(", ")}, or type an answer.`
        : "Reply with your answer.";
      try {
        await c.say(`Question ${id}\n${question}\n${how}`);
      } catch (e) {
        c.update((s) => void (s.questions = s.questions.filter((q) => q.id !== id)));
        throw e;
      }
      return `Sent as ${id}. The answer will arrive as a channel event with question_id="${id}".`;
    },
  };

  const notify: Tool = {
    name: "notify",
    description: "Tell the away user something in Teams: type finished (task done, 2-3 lines), error (stuck or failing) or info.",
    inputSchema: obj({ type: { type: "string", enum: Object.keys(HEADERS) }, text: { type: "string" } }, ["type", "text"]),
    async run(a) {
      requireAway(c);
      const type = String(a.type);
      if (!Object.hasOwn(HEADERS, type)) throw new Error("type must be finished, error or info.");
      await c.say(`${HEADERS[type]}\n${text(a.text, "text")}`);
      return "Sent.";
    },
  };

  const setAway: Tool = {
    name: "set_away",
    description:
      'Turn Away Mode on or off. Call it with on=true when the user says they\'re stepping away, going to lunch, in a meeting, heading home or done for the day. Say how long with ONE of: minutes ("for 30 minutes" = 30), at as the local clock time they gave ("back at 1:30" = "1:30", "until 5pm" = "5pm"), or until as an exact ISO time. The server uses its own clock, so don\'t work out the date yourself. Leave all three out for the default length. Call it with on=false when they say they\'re back.',
    inputSchema: obj(
      { on: { type: "boolean" }, minutes: { type: "number" }, at: { type: "string" }, until: { type: "string" } },
      ["on"],
    ),
    async run(a) {
      const now = c.deps.now();
      if (a.on !== true) {
        c.update((s) => void (s.awayUntil = 0));
        return "Away mode off.";
      }
      const until = resolveUntil(a, now, c.deps.hours);
      if (!(until > now)) {
        throw new Error(`Couldn't work out a future end time. It is now ${new Date(now).toString()}. Pass minutes, at (like "1:30" or "5pm"), or a future ISO until.`);
      }
      c.update((s) => {
        // Replies typed before going away aren't for us; extending keeps the cursor.
        if (!isAway(s, now)) s.cursor = new Date(now).toISOString();
        s.awayUntil = until;
      });
      c.startPolling();
      return `Away mode on until ${new Date(until).toString()}. Tell the user (in their local time) that you'll message them on Teams.`;
    },
  };

  return [ask, notify, setAway];
}
