// Reading the paired 1:1 chat through Microsoft Graph: shared by the bot and workflow routes.
import { bearer, call, type Net } from "../http.ts";
import type { Msg } from "./adapter.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const CARD = "application/vnd.microsoft.card.adaptive";
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** Teams sends HTML bodies; Claude gets plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e] ?? "")
    .trim();
}

export interface GraphMsg {
  id: string;
  messageType?: string;
  createdDateTime?: string;
  lastModifiedDateTime: string;
  lastEditedDateTime?: string | null;
  deletedDateTime?: string | null;
  from?: { user?: { id?: string } | null; application?: { id?: string } | null } | null;
  body?: { content?: string };
  attachments?: { contentType?: string; content?: string | null }[];
}

/** Every TextBlock / TextRun text in a card, in order. */
function cardTexts(node: unknown, out: string[]): string[] {
  if (Array.isArray(node)) for (const n of node) cardTexts(n, out);
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if ((o.type === "TextBlock" || o.type === "TextRun") && typeof o.text === "string") out.push(o.text);
    for (const k of ["body", "inlines", "items", "columns"]) if (k in o) cardTexts(o[k], out);
  }
  return out;
}

/** A bot message's text: its body, or for an Adaptive Card the card's text. */
export function botText(m: GraphMsg): string {
  const parts: string[] = [];
  for (const a of m.attachments ?? []) {
    if (a.contentType !== CARD || !a.content) continue;
    try {
      cardTexts(JSON.parse(a.content), parts);
    } catch {
      // unparseable card: no text from it
    }
  }
  return parts.length ? parts.join("\n") : htmlToText(m.body?.content ?? "");
}

// `[Claude · tag]` (bot route) or a first line `Claude Code · tag` (cards).
const BOT_TAG = /^\[Claude(?: · ([^\]]+))?\]|^Claude Code · (.+)$/m;
const MAX_BOT = 200;

/** The quoted message's ID when this reply quotes one. */
function quotedId(m: GraphMsg): string | undefined {
  const a = m.attachments?.find((x) => x.contentType === "messageReference");
  if (!a?.content) return undefined;
  try {
    return JSON.parse(a.content).messageId;
  } catch {
    return undefined; // unparseable reference: treat as a plain reply
  }
}

/** A fresh reply from a person: not the bot, not a system event, not an edit or deletion. */
const isReply = (m: GraphMsg): boolean =>
  m.messageType === "message" && !!m.from?.user?.id && !m.deletedDateTime && !m.lastEditedDateTime;

export interface ChatReader {
  poll(since: string): Promise<Msg[]>;
}

export interface ChatOptions {
  chatId: string;
  token(): Promise<string>;
  net: Net;
  /** Which app messages are Away Mode's own (default: all). Only those teach reply tags. */
  ours?(m: GraphMsg): boolean;
}

export function graphChat(o: ChatOptions): ChatReader {
  // Bot message ID -> project tag, learned from our own messages in poll pages. Newest 200 (Map keeps insertion order).
  const botTags = new Map<string, string>();
  const learn = (m: GraphMsg) => {
    if (o.ours && !o.ours(m)) return;
    const text = botText(m);
    const hit = BOT_TAG.exec(text);
    const tag = (hit?.[1] ?? hit?.[2])?.trim();
    if (!tag) return;
    botTags.delete(m.id);
    botTags.set(m.id, tag);
    if (botTags.size > MAX_BOT) botTags.delete(botTags.keys().next().value!);
  };

  return {
    // ponytail: one page of 50 is plenty at a 5-60 s interval; follow @odata.nextLink if bursts ever exceed it.
    async poll(since) {
      // Graph ignores $filter unless $orderby names the same property, and only sorts descending.
      const q = new URLSearchParams({ $top: "50", $orderby: "lastModifiedDateTime desc" });
      if (since) q.set("$filter", `lastModifiedDateTime gt ${since}`);
      const r = await call(o.net, `${GRAPH}/chats/${encodeURIComponent(o.chatId)}/messages?${q}`, bearer(await o.token()));
      const page = ((r.value ?? []) as GraphMsg[]).slice().reverse();
      for (const m of page) if (m.from?.application) learn(m);
      return page.filter(isReply).map((m): Msg => {
        const msg: Msg = {
          id: m.id, from: m.from!.user!.id!, text: htmlToText(m.body?.content ?? ""),
          at: m.lastModifiedDateTime, sentAt: m.createdDateTime,
        };
        const id = quotedId(m);
        const replyTag = id ? botTags.get(id) : undefined;
        return replyTag ? { ...msg, replyTag } : msg;
      });
    },
  };
}
