import type { Adapter } from "./adapters/adapter.ts";
import type { Routed } from "./dispatch.ts";
import { createServer, type Json, type Tool } from "./mcp.ts";
import { MIN_DELAY, pollLoop } from "./poll.ts";
import { adopt, drainOwned, makeAct } from "./deliver.ts";
import { pollCycle, sweepExpired } from "./poller.ts";
import { beginAway, endedAtTerminal, endProject, type EndReason } from "./recap.ts";
import { createRelay } from "./relay.ts";
import { redact } from "./sensitive.ts";
import { isAway, load, save, tagOf, type State } from "./state.ts";
import { type Ctx, makeTools } from "./tools.ts";

export interface Deps {
  adapter: Adapter;
  /** More tools that need the shared context (setup). */
  extraTools?: (ctx: Ctx) => Tool[];
  dir: string;
  /** This server's project key (projectKey of its folder); "default" in tests. */
  key?: string;
  project: string;
  hours: number;
  waitMinutes: number;
  /** Patterns approved only at the terminal (never_relay). */
  neverRelay?: string[];
  /** With no reply after waitMinutes: park the task, or continue safely. */
  endOfDay?: "park" | "safest";
  /** This server's instance token (tests inject one). */
  instance?: string;
  now(): number;
  sleep(ms: number): Promise<void>;
  write(line: string): void;
}

const CAP = 1200;
const INSTRUCTIONS = [
  "Away Mode relays to the user over Microsoft Teams while they are away from the terminal.",
  "Use set_away when the user says they are stepping away (pass minutes, or at as the clock time they said; the server resolves it) or are back.",
  "While away: ask questions with the ask tool instead of AskUserQuestion; when a task finishes, notify type=finished",
  "with a two or three line summary; when stuck or failing, notify type=error.",
  "Their messages arrive as channel events. kind=answer carries the question_id of an earlier ask;",
  "kind=instruction is a new instruction from the user; kind=back means they ended away mode from Teams.",
  "Never ask for passwords, keys, tokens or other secrets through ask or notify. Tell the user to return to the terminal.",
].join(" ");

export function createAway(d: Deps) {
  let polling = false;
  const key = d.key ?? "default";
  const instance = d.instance ?? crypto.randomUUID();

  // ponytail: pending permissions expire after wait_minutes because Claude Code never says
  // when the terminal answered first. Upgrade if it ever sends a cancel notification.
  function current(): State {
    const s = load(d.dir, key);
    const cutoff = d.now() - d.waitMinutes * 60_000;
    s.permissions = s.permissions.filter((p) => p.at > cutoff);
    return s;
  }
  /** Load, change, save with no await in between, so concurrent handlers can't clobber state. */
  function update(fn: (s: State) => void): State {
    const s = current();
    fn(s);
    save(d.dir, s, key);
    return s;
  }
  const away = () => isAway(current(), d.now());
  const announce = (name: string, text: string) => {
    const full = redact(`[${name ? `Claude · ${name}` : "Claude"}] ${text}`);
    return d.adapter.send(full.length > CAP ? `${full.slice(0, CAP - 1)}…` : full);
  };
  const say = (text: string) => announce(d.project, text);
  const life = { dir: d.dir, key, instance, now: d.now };
  const end = (reason: EndReason) => endProject(life, reason);
  const poller = () => ({ dir: d.dir, key, now: d.now, adapter: d.adapter, deliverLocal: (r: Routed) => act(r.action), announce });

  function startPolling(): void {
    if (polling) return;
    polling = true;
    const fail = (what: string) => (e: Error) => console.error(`away-mode: ${what} failed: ${e.message}`);
    void pollLoop({ fetch: pollOnce, away, sleep: d.sleep })
      .then(() => sweepExpired(poller()))
      .catch(fail("expiry"))
      .finally(() => void (polling = false));
    // Own short timer (Graph backoff mustn't delay a second project's replies); one last pass after away flips off sends a terminal recap.
    void (async () => {
      for (let on = true; on; ) {
        on = away();
        await drainMine().catch(fail("inbox"));
        if (on) await d.sleep(MIN_DELAY);
      }
    })();
  }

  /** Owner only. Away is re-checked before each item, so nothing is acted on after `back`. */
  async function drainMine(): Promise<void> {
    const ended = endedAtTerminal(life);
    if (ended) await say(ended);
    adopt(d.dir, key, instance, d.now());
    for (const a of drainOwned(d.dir, key, instance, d.now())) if (away()) await act(a);
  }

  async function pollOnce(): Promise<number> {
    await relay.sweepTimeouts();
    await relay.drainOutbox();
    await drainMine();
    return pollCycle(poller());
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

  async function onNotification(method: string, p: Json): Promise<void> {
    if (method === "notifications/claude/channel/permission_request") await relay.onPermissionRequest(p);
  }

  const act = makeAct({
    dir: d.dir, key, instance, now: d.now, hours: d.hours, current, update, say, channel, answer,
    notify: (m, p) => server.notify(m, p), end,
  });

  const relay = createRelay({
    instance, current, update, say, channel, now: d.now, waitMinutes: d.waitMinutes,
    neverRelay: (d.neverRelay ?? []).map((p) => p.toLowerCase()),
    endOfDay: d.endOfDay ?? "park",
  });

  const ctx = { deps: d, current, update, say, startPolling, startAway: (until: number) => beginAway(life, tagOf(key), until), endAway: end };
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
