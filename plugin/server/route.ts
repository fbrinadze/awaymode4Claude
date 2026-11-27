import type { Msg } from "./adapters/adapter.ts";
import type { State } from "./state.ts";

export type Action =
  | { kind: "drop" }
  | { kind: "verdict"; id: string; behavior: "allow" | "deny" }
  | { kind: "confirm"; id: string; behavior: "allow" | "deny"; text: string }
  | { kind: "prompt"; text: string }
  | { kind: "answer"; questionId: string; text: string }
  | { kind: "instruction"; text: string }
  | { kind: "status" }
  | { kind: "back" };

// Claude Code request IDs: five letters a-z without "l".
const VERDICT = /^(y|yes|n|no)(?:\s+([a-km-z]{5}))?$/i;
const TYPO = /^(y|yes|n|no)\s+([a-z]{4,6})$/i;
const TARGETED = /^#(q\d+)\s+([\s\S]+)$/i;

/** True when a and b differ by exactly one insert, delete, substitute or adjacent swap. */
export function oneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length !== b.length) {
    const [s, l] = a.length < b.length ? [a, b] : [b, a];
    return Array.from(l, (_, i) => l.slice(0, i) + l.slice(i + 1)).includes(s);
  }
  const d = [...a].flatMap((c, i) => (c === b[i] ? [] : [i]));
  if (d.length === 1) return true;
  const [i, j] = d;
  return d.length === 2 && j === i! + 1 && a[i!] === b[j!] && a[j!] === b[i!];
}

/**
 * `yes <id>` / `no <id>` for a live request (case and surrounding punctuation ignored).
 * A bare yes/no only when exactly one is open; with several, ask which. A near-miss ID
 * of exactly one live request is never approved: it asks for confirmation.
 */
export function parseVerdict(text: string, s: State): Action | null {
  const t = text.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "").replace(/\s+/g, " ");
  const behavior = /^y/i.test(t) ? "allow" : "deny";
  const m = VERDICT.exec(t);
  const ids = s.permissions.map((p) => p.id);
  if (m && !m[2] && ids.length > 1) {
    const verb = behavior === "allow" ? "yes" : "no";
    return { kind: "prompt", text: `Which one? Reply ${ids.map((i) => `${verb} ${i}`).join(" or ")}` };
  }
  const id = m?.[2]?.toLowerCase() ?? (ids.length === 1 ? ids[0] : undefined);
  if (m && id && ids.includes(id)) return { kind: "verdict", id, behavior };
  const typo = TYPO.exec(t)?.[2]?.toLowerCase();
  const near = typo ? ids.filter((i) => oneEdit(typo, i)) : [];
  if (near.length !== 1) return null;
  const verb = behavior === "allow" ? "yes" : "no";
  return { kind: "confirm", id: near[0]!, behavior, text: `Did you mean "${verb} ${near[0]}"? Reply exactly to approve.` };
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
