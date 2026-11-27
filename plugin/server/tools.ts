import type { Json, Tool } from "./mcp.ts";
import type { EndReason } from "./recap.ts";
import { asksForSecret, SENSITIVE_TEXT } from "./sensitive.ts";
import { isAway, type State } from "./state.ts";
import { resolveUntil } from "./when.ts";

export interface Ctx {
  deps: { hours: number; now(): number };
  current(): State;
  update(fn: (s: State) => void): State;
  say(text: string): Promise<void>;
  startPolling(): void;
  /** A clean new away period (clears pending items, takes delivery ownership). */
  startAway(until: number): void;
  /** End away mode and return the recap text. */
  endAway(reason: EndReason): string;
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

/** Away state, open questions and pending approvals, for `status` in Teams and the status tool. */
export function statusText(s: State, now: number): string {
  const until = isAway(s, now) ? `Away until ${new Date(s.awayUntil).toString()}` : "Not away";
  const qs = s.questions.map((q) => `\n${q.id}: ${q.text}`).join("");
  return `${until}. ${s.questions.length} open question(s), ${s.permissions.length} pending approval(s).${qs}`;
}

export function makeTools(c: Ctx): Tool[] {
  /** Claude reached the user this turn; the Stop hook checks this. Server acks don't call it. */
  const sent = () => c.update((s) => void (s.lastSentAt = c.deps.now()));
  const NOT_SENT = "Not sent: secrets can't be shared over Teams. The user was told to come back to the terminal; park anything that needs it.";
  /** If any model-written part asks for a secret, send the fixed notice instead of the message. */
  const refuse = async (parts: string[]): Promise<boolean> => {
    if (!parts.some(asksForSecret)) return false;
    await c.say(SENSITIVE_TEXT);
    sent();
    return true;
  };

  const ask: Tool = {
    name: "ask",
    description: "Ask the away user a question in Teams. Returns at once; the answer arrives later as a channel event with kind=answer and this question_id. Never ask for passwords, keys, codes or other secrets.",
    inputSchema: obj({ question: { type: "string" }, options: { type: "array", items: { type: "string" } } }, ["question"]),
    async run(a) {
      requireAway(c);
      const question = text(a.question, "question");
      const options = Array.isArray(a.options) ? a.options.map(String) : [];
      if (await refuse([question, ...options])) return NOT_SENT;
      let id = "";
      c.update((s) => {
        id = `q${s.nextQ++}`;
        s.questions.push({ id, text: question, options, askedAt: c.deps.now() });
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
      sent();
      return `Sent as ${id}. The answer will arrive as a channel event with question_id="${id}".`;
    },
  };

  const notify: Tool = {
    name: "notify",
    description:
      "Tell the away user something in Teams: type finished (task done, 2-3 lines), error (stuck or failing), info, or sensitive (you need a secret: sends a fixed 'come back to the terminal' message, never the secret).",
    inputSchema: obj({ type: { type: "string", enum: [...Object.keys(HEADERS), "sensitive"] }, text: { type: "string" } }, ["type", "text"]),
    async run(a) {
      requireAway(c);
      const type = String(a.type);
      if (type === "sensitive") await c.say(SENSITIVE_TEXT);
      else if (Object.hasOwn(HEADERS, type)) {
        const body = text(a.text, "text");
        if (await refuse([body])) return NOT_SENT;
        if (type !== "error" && c.current().snoozeUntil > c.deps.now()) {
          c.update((s) => void s.recap.push({ kind: type as "finished" | "info", text: body }));
          sent();
          return "Held for the user's recap: they snoozed Teams. Questions, approvals and errors still go through.";
        }
        await c.say(`${HEADERS[type]}\n${body}`);
      } else throw new Error("type must be finished, error, info or sensitive.");
      sent();
      return "Sent.";
    },
  };

  const status: Tool = {
    name: "status",
    description: "Whether Away Mode is on, until when, and which questions and approvals are still open.",
    inputSchema: obj({}, []),
    run: async () => statusText(c.current(), c.deps.now()),
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
        const wasAway = isAway(c.current(), now);
        const recap = c.endAway("off");
        if (wasAway) await c.say(recap);
        return "Away mode off.";
      }
      const until = resolveUntil(a, now, c.deps.hours);
      if (!(until > now)) {
        throw new Error(`Couldn't work out a future end time. It is now ${new Date(now).toString()}. Pass minutes, at (like "1:30" or "5pm"), or a future ISO until.`);
      }
      c.startAway(until); // awayStartedAt lets the Stop hook end this turn without a "finished" note
      c.startPolling();
      return `Away mode on until ${new Date(until).toString()}. Tell the user (in their local time) that you'll message them on Teams.`;
    },
  };

  return [ask, notify, setAway, status];
}
