// The workflow route's Adaptive Card: says Claude Code and the project, since the sender shows as "Workflows".
import type { Kind, SendMeta } from "./adapter.ts";

const LABELS: Record<Kind, string> = {
  question: "Question", approval: "Approval needed", done: "Done", error: "Error",
  update: "Update", recap: "Recap", setup: "Setup", reply: "Reply",
};
const PREFIX = /^\[Claude(?: · [^\]]+)?\] /;

/**
 * Text goes in TextRuns, which Teams shows literally: a TextBlock would read `*`, `_` and `[x](y)` as
 * markdown. One run per line with a newline run between. For approvals the third line is the command.
 */
function lines(text: string, kind: Kind | undefined): Record<string, unknown>[] {
  return text.replace(PREFIX, "").split("\n").flatMap((line, i) => {
    const run = { type: "TextRun", text: line, ...(kind === "approval" && i === 2 && { fontType: "Monospace" }) };
    return i === 0 ? [run] : [{ type: "TextRun", text: "\n" }, run];
  });
}

export function buildCard(text: string, meta: SendMeta | undefined, ref: string): Record<string, unknown> {
  const kind = meta?.kind ?? "reply";
  return {
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      { type: "TextBlock", text: meta?.project ? `Claude Code · ${meta.project}` : "Claude Code", weight: "Bolder", size: "Medium", color: "Accent", wrap: true },
      { type: "TextBlock", text: `Away Mode · ${LABELS[kind]}`, isSubtle: true, size: "Small", spacing: "None", wrap: true },
      { type: "RichTextBlock", inlines: lines(text, meta?.kind) },
      { type: "TextBlock", text: `ref ${ref}`, isSubtle: true, size: "Small", wrap: true },
    ],
  };
}

export function cardMessage(card: object) {
  return { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }] };
}
