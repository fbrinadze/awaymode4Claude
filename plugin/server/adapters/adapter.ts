/** A chat message read back from the messaging platform. */
export interface Msg {
  id: string;
  /** Platform user ID of the sender (Entra object ID for Teams). */
  from: string;
  text: string;
  /** ISO timestamp; also the poll cursor once processed. */
  at: string;
  /** ISO time the user actually sent it (Graph createdDateTime), when known; `at` may be a later edit time. */
  sentAt?: string;
  /** Project tag of the bot message this reply quotes, when known (Teams reply-to-message). */
  replyTag?: string;
}

/** What a message is, for adapters that render a header (the workflow route's cards). */
export type Kind = "question" | "approval" | "done" | "error" | "update" | "recap" | "setup" | "reply";

/** Optional context for send(); adapters that only send text ignore it. */
export interface SendMeta {
  project?: string;
  kind?: Kind;
  /** The command inside the text (approvals), shown in a fixed-width font where the adapter can. */
  code?: string;
}

/** One messaging platform. Another must fit by adding a file, not changing this. */
export interface Adapter {
  /** Post a message to the paired user as the bot. */
  send(text: string, meta?: SendMeta): Promise<void>;
  /** Messages newer than `since` (ISO timestamp), oldest first. */
  poll(since: string): Promise<Msg[]>;
  /** The paired user's platform ID. */
  me(): Promise<string>;
}
