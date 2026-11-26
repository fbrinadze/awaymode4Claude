import type { Msg } from "./adapters/adapter.ts";
import type { State } from "./state.ts";

export type Action =
  | { kind: "drop" }
  | { kind: "verdict"; id: string; behavior: "allow" | "deny" }
  | { kind: "answer"; questionId: string; text: string }
  | { kind: "instruction"; text: string }
  | { kind: "status" }
  | { kind: "back" };

// Claude Code request IDs: five letters a-z without "l".
const VERDICT = /^(y|yes|n|no)(?:\s+([a-km-z]{5}))?$/i;
const TARGETED = /^#(q\d+)\s+([\s\S]+)$/i;

/** `yes <id>` / `no <id>` for a live request; a bare yes/no only when exactly one is open. */
export function parseVerdict(text: string, s: State): Action | null {
  const m = VERDICT.exec(text);
  if (!m) return null;
  const id = m[2]?.toLowerCase() ?? (s.permissions.length === 1 ? s.permissions[0]?.id : undefined);
  if (!id || !s.permissions.some((p) => p.id === id)) return null;
  return { kind: "verdict", id, behavior: m[1]?.toLowerCase().startsWith("y") ? "allow" : "deny" };
}

/** `#q2 use last month` answers that question, if it's still open. */
export function parseTargeted(text: string, s: State): Action | null {
  const m = TARGETED.exec(text);
  const id = m?.[1]?.toLowerCase();
  if (!m || !s.questions.some((q) => q.id === id)) return null;
  return { kind: "answer", questionId: id!, text: m[2]!.trim() };
}

/** Exact `status` or `back`, nothing else. */
export function parseCommand(text: string): Action | null {
  const word = text.toLowerCase();
  return word === "status" || word === "back" ? { kind: word } : null;
}

/** Plain text answers the newest open question. */
export function answerLatest(text: string, s: State): Action | null {
  const q = s.questions.at(-1);
  return q ? { kind: "answer", questionId: q.id, text } : null;
}

/** Decide what one inbound message means. Pure: no I/O. */
export function route(msg: Msg, s: State): Action {
  // The whole security model: only the paired account gets through.
  if (!s.me || msg.from !== s.me) return { kind: "drop" };
  const text = msg.text.trim();
  if (!text) return { kind: "drop" };
  // Verdicts first (PLAN.md). Commands beat plain answers so "back" always works from a phone;
  // the cost is that a bare "back" or "status" can't answer a question (use "#qN back").
  return (
    parseVerdict(text, s) ??
    parseTargeted(text, s) ??
    parseCommand(text) ??
    answerLatest(text, s) ?? { kind: "instruction", text }
  );
}
