/** A chat message read back from the messaging platform. */
export interface Msg {
  id: string;
  /** Platform user ID of the sender (Entra object ID for Teams). */
  from: string;
  text: string;
  /** ISO timestamp; also the poll cursor once processed. */
  at: string;
}

/** One messaging platform. Another must fit by adding a file, not changing this. */
export interface Adapter {
  /** Post a message to the paired user as the bot. */
  send(text: string): Promise<void>;
  /** Messages newer than `since` (ISO timestamp), oldest first. */
  poll(since: string): Promise<Msg[]>;
  /** The paired user's platform ID. */
  me(): Promise<string>;
}
