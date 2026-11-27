// Which away project(s) an inbound Teams message is for (spec 5.5). Pure: no I/O.
import type { Msg } from "./adapters/adapter.ts";
import { tagFor } from "./project.ts";
import { parseCommand } from "./commands.ts";
import { parseTargeted, parseVerdict, routeProject, type Action } from "./route.ts";
import { fresh, type State } from "./state.ts";
import type { Store } from "./store.ts";

export interface Routed {
  /** Project keys the action is for; empty for drop and prompt. */
  targets: string[];
  action: Action;
}

const TAGGED = /^@(\S+)\s*([\s\S]*)$/;
const ID_VERDICT = /^(?:y|yes|n|no)\s+([a-km-z]{5})$/i;
const prompt = (text: string): Routed => ({ targets: [], action: { kind: "prompt", text } });
const view = (s: Store, keys: string[]): State => ({
  ...fresh(),
  me: s.me,
  questions: keys.flatMap((k) => s.projects[k]!.questions),
  permissions: keys.flatMap((k) => s.projects[k]!.permissions),
});
const ownerOf = (s: Store, keys: string[], has: (k: string) => boolean) => keys.find(has);

/** `@tag rest`: the rest is routed inside that project only. */
function tagged(tag: string, rest: string, s: Store, away: string[], sentAt: number): Routed {
  const key = away.find((k) => tagFor(k, s).toLowerCase() === tag.toLowerCase());
  if (!key) return prompt(`No project called ${tag} is away. Away now: ${away.map((k) => tagFor(k, s)).join(", ")}.`);
  if (!rest) return prompt(`What should I tell ${tagFor(key, s)}?`);
  const id = ID_VERDICT.exec(rest.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "").replace(/\s+/g, " "))?.[1]?.toLowerCase();
  const other = id && !s.projects[key]!.permissions.some((p) => p.id === id)
    ? ownerOf(s, away, (k) => s.projects[k]!.permissions.some((p) => p.id === id))
    : undefined;
  if (other) return prompt(`${id} is waiting in ${tagFor(other, s)}, not ${tagFor(key, s)}.`);
  return { targets: [key], action: routeProject(rest, view(s, [key]), sentAt) };
}

/** The project a verdict, confirm or targeted answer belongs to. */
function owner(a: Action, s: Store, away: string[]): string | undefined {
  if (a.kind === "verdict" || a.kind === "confirm") return ownerOf(s, away, (k) => s.projects[k]!.permissions.some((p) => p.id === a.id));
  if (a.kind === "answer") return ownerOf(s, away, (k) => s.projects[k]!.questions.some((q) => q.id === a.questionId));
  return undefined;
}

/** Plain text with several projects away: only an unambiguous answer gets through. */
function plain(text: string, s: Store, away: string[]): Routed {
  const all = view(s, away);
  const only = all.questions.length === 1 ? all.questions[0]!.id : undefined;
  const key = only ? ownerOf(s, away, (k) => s.projects[k]!.questions.some((q) => q.id === only)) : undefined;
  if (key) return { targets: [key], action: { kind: "answer", questionId: only!, text } };
  return prompt(`Which project? Start with ${away.map((k) => `@${tagFor(k, s)}`).join(" or ")}.`);
}

export function dispatch(msg: Msg, s: Store, now: number): Routed {
  // The whole security model: only the paired account gets through.
  if (!s.me || msg.from !== s.me) return { targets: [], action: { kind: "drop" } };
  const text = msg.text.trim();
  const away = Object.keys(s.projects).filter((k) => s.projects[k]!.awayUntil > now);
  if (!text || !away.length) return { targets: [], action: { kind: "drop" } };
  const sentAt = Date.parse(msg.sentAt ?? msg.at);
  const t = TAGGED.exec(text);
  if (t) return tagged(t[1]!, t[2]!.trim(), s, away, sentAt);
  const all = view(s, away);
  // Verdicts and #qN are matched over every away project's items; one project behaves as in v1.0.1.
  const a = parseVerdict(text, all, sentAt) ?? parseTargeted(text, all);
  if (a) return a.kind === "prompt" ? { targets: [], action: a } : { targets: [owner(a, s, away)!], action: a };
  const cmd = parseCommand(text);
  if (cmd?.kind === "more") {
    const key = ownerOf(s, away, (k) => s.projects[k]!.permissions.some((p) => p.id === cmd.id));
    return key ? { targets: [key], action: cmd } : prompt(`No request ${cmd.id} is waiting.`);
  }
  if (cmd) return { targets: away, action: cmd };
  if (away.length === 1) return { targets: away, action: routeProject(text, all, sentAt) };
  return plain(text, s, away);
}
