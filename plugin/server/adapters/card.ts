// The workflow route's Adaptive Card: says Claude Code and the project, since the sender shows as "Workflows".
import type { Kind, SendMeta } from "./adapter.ts";

const LABELS: Record<Kind, string> = {
  question: "Question", approval: "Approval needed", done: "Done", error: "Error",
  update: "Update", recap: "Recap", setup: "Setup", reply: "Reply",
};
const PREFIX = /^\[Claude(?: · [^\]]+)?\] /;

/**
 * Text goes in TextRuns, which Teams shows literally: a TextBlock would read `*`, `_` and `[x](y)` as
 * markdown. One run per line with a newline run between. Lines inside `code` (the command) are monospace.
 */
function lines(text: string, code: string | undefined): Record<string, unknown>[] {
  const body = text.replace(PREFIX, "");
  const at = code ? body.indexOf(code) : -1;
  const end = at + (code?.length ?? 0);
  let pos = 0;
  return body.split("\n").flatMap((line, i) => {
    const mono = at >= 0 && pos >= at && pos + line.length <= end;
    pos += line.length + 1;
    const run = { type: "TextRun", text: line, ...(mono && { fontType: "Monospace" }) };
    return i === 0 ? [run] : [{ type: "TextRun", text: "\n" }, run];
  });
}

export function buildCard(text: string, meta: SendMeta | undefined, ref: string): Record<string, unknown> {
  const kind = meta?.kind ?? "reply";
  return {
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      // The project is a folder name, so it's a literal TextRun too: `_x_` must not turn italic.
      // The install marker is this element's id: never shown, kept by Power Automate and Graph (live probe).
      { type: "RichTextBlock", id: `away-${ref}`, inlines: [{ type: "TextRun", text: meta?.project ? `Claude Code · ${meta.project}` : "Claude Code", weight: "Bolder", size: "Medium", color: "Accent" }] },
      { type: "TextBlock", text: `Away Mode · ${LABELS[kind]}`, isSubtle: true, size: "Small", spacing: "None", wrap: true },
      { type: "RichTextBlock", inlines: lines(text, meta?.code) },
    ],
  };
}

/** True if any element in these card attachments has our marker as its id (not merely as text). */
export function hasMarker(attachments: { contentType?: string; content?: string | null }[], ref: string): boolean {
  const want = `away-${ref}`;
  const walk = (n: unknown): boolean =>
    Array.isArray(n) ? n.some(walk) : !!n && typeof n === "object" && ((n as { id?: unknown }).id === want || Object.values(n).some(walk));
  return attachments.some((a) => {
    if (a.contentType !== "application/vnd.microsoft.card.adaptive" || !a.content) return false;
    try {
      return walk(JSON.parse(a.content));
    } catch {
      return false; // unparseable card: not ours
    }
  });
}

export function cardMessage(card: object) {
  return { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }] };
}
