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
    description: "Turn away mode on (optionally until an ISO time) or off.",
    inputSchema: obj({ on: { type: "boolean" }, until: { type: "string" } }, ["on"]),
    async run(a) {
      const now = c.deps.now();
      if (a.on !== true) {
        c.update((s) => void (s.awayUntil = 0));
        return "Away mode off.";
      }
      const until = a.until === undefined ? now + c.deps.hours * 3_600_000 : Date.parse(String(a.until));
      if (!(until > now)) throw new Error("until must be a future ISO time.");
      c.update((s) => {
        // Replies typed before going away aren't for us; extending keeps the cursor.
        if (!isAway(s, now)) s.cursor = new Date(now).toISOString();
        s.awayUntil = until;
      });
      c.startPolling();
      return `Away mode on until ${new Date(until).toISOString()}. Tell the user you'll message them on Teams.`;
    },
  };

  return [ask, notify, setAway];
}
