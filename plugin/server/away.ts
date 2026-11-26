import type { Adapter, Msg } from "./adapters/adapter.ts";
import { createServer, type Json, type Tool } from "./mcp.ts";
import { pollLoop } from "./poll.ts";
import { route, type Action } from "./route.ts";
import { isAway, load, save, type State } from "./state.ts";
import { type Ctx, makeTools } from "./tools.ts";

export interface Deps {
  adapter: Adapter;
  /** More tools that need the shared context (setup). */
  extraTools?: (ctx: Ctx) => Tool[];
  dir: string;
  project: string;
  hours: number;
  waitMinutes: number;
  now(): number;
  sleep(ms: number): Promise<void>;
  write(line: string): void;
}

const CAP = 1200;
const REQUEST_ID = /^[a-km-z]{5}$/;
const INSTRUCTIONS = [
  "Away Mode relays to the user over Microsoft Teams while they are away from the terminal.",
  "Use set_away when the user says they are stepping away (pass until as an ISO time if they gave one) or are back.",
  "While away: ask questions with the ask tool instead of AskUserQuestion; when a task finishes, notify type=finished",
  "with a two or three line summary; when stuck or failing, notify type=error.",
  "Their messages arrive as channel events. kind=answer carries the question_id of an earlier ask;",
  "kind=instruction is a new instruction from the user; kind=back means they ended away mode from Teams.",
  "Never ask for passwords, keys, tokens or other secrets through ask or notify. Tell the user to return to the terminal.",
].join(" ");

export function createAway(d: Deps) {
  let polling = false;

  // ponytail: pending permissions expire after wait_minutes because Claude Code never says
  // when the terminal answered first. Upgrade if it ever sends a cancel notification.
  function current(): State {
    const s = load(d.dir);
    const cutoff = d.now() - d.waitMinutes * 60_000;
    s.permissions = s.permissions.filter((p) => p.at > cutoff);
    return s;
  }

  /** Load, change, save with no await in between, so concurrent handlers can't clobber state. */
  function update(fn: (s: State) => void): State {
    const s = current();
    fn(s);
    save(d.dir, s);
    return s;
  }

  const away = () => isAway(current(), d.now());
  const say = (text: string) => {
    const full = `[${d.project}] ${text}`;
    return d.adapter.send(full.length > CAP ? `${full.slice(0, CAP - 1)}…` : full);
  };

  function startPolling(): void {
    if (polling) return;
    polling = true;
    void pollLoop({ fetch: pollOnce, away, sleep: d.sleep }).finally(() => {
      polling = false;
    });
  }

  /** Cursor moves before handling: a message is acted on at most once. */
  async function pollOnce(): Promise<number> {
    const msgs = await d.adapter.poll(current().cursor);
    for (const m of msgs) {
      update((s) => {
        s.cursor = m.at;
      });
      await onMsg(m);
    }
    return msgs.length;
  }

  async function onMsg(m: Msg): Promise<void> {
    await act(route(m, current()));
  }

  async function act(a: Action): Promise<void> {
    switch (a.kind) {
      case "drop":
        return;
      case "verdict":
        update((s) => void (s.permissions = s.permissions.filter((p) => p.id !== a.id)));
        server.notify("notifications/claude/channel/permission", { request_id: a.id, behavior: a.behavior });
        return say(a.behavior === "allow" ? "Approved." : "Denied.");
      case "answer":
        return answer(a.questionId, a.text);
      case "instruction":
        channel(a.text, { kind: "instruction" });
        return say("Got it, passing that to Claude.");
      case "status":
        return say(statusText(current()));
      case "back":
        update((s) => void (s.awayUntil = 0));
        channel("The user ended away mode from Teams.", { kind: "back" });
        return say("Away mode off. Welcome back.");
    }
  }

  async function answer(id: string, text: string): Promise<void> {
    const q = current().questions.find((x) => x.id === id);
    if (!q) return;
    update((s) => void (s.questions = s.questions.filter((x) => x.id !== id)));
    const n = Number(text);
    const picked = Number.isInteger(n) ? q.options[n - 1] : undefined;
    channel(picked ? `${text} (${picked})` : text, { kind: "answer", question_id: id });
    await say("Got it.");
  }

  function channel(content: string, meta: Record<string, string>): void {
    server.notify("notifications/claude/channel", { content, meta });
  }

  function statusText(s: State): string {
    const until = isAway(s, d.now()) ? `Away until ${new Date(s.awayUntil).toISOString()}` : "Not away";
    return `${until}. ${s.questions.length} open question(s), ${s.permissions.length} pending approval(s).`;
  }

  async function onNotification(method: string, p: Json): Promise<void> {
    if (method !== "notifications/claude/channel/permission_request") return;
    const id = String(p.request_id ?? "");
    if (!away() || !REQUEST_ID.test(id)) return;
    await say(`Permission needed\n${p.tool_name}: ${p.description}\n${p.input_preview}\nReply "yes ${id}" or "no ${id}".`);
    update((s) => void s.permissions.push({ id, tool: String(p.tool_name), at: d.now() }));
  }

  const ctx = { deps: d, current, update, say, startPolling };
  const server = createServer(
    { name: "away-mode", version: "0.1.0", instructions: INSTRUCTIONS, tools: [...makeTools(ctx), ...(d.extraTools?.(ctx) ?? [])], onNotification },
    d.write,
  );

  return {
    ctx,
    handle: server.handle,
    pollOnce,
    /** After a restart mid-away, pick polling back up. */
    resume: () => (away() ? startPolling() : undefined),
  };
}
