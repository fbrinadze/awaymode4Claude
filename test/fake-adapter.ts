import type { Adapter, Msg } from "../plugin/server/adapters/adapter.ts";

/** Records what the bot sends; tests queue inbound messages in `inbox`. */
export class FakeAdapter implements Adapter {
  sent: string[] = [];
  inbox: Msg[] = [];
  private seq = 0;

  constructor(readonly user = "user-1") {}

  /** Set to simulate Teams being unreachable. */
  failSends = false;

  async send(text: string): Promise<void> {
    if (this.failSends) throw new Error("Teams unreachable");
    this.sent.push(text);
  }

  async poll(since: string): Promise<Msg[]> {
    const out = this.inbox.filter((m) => m.at > since);
    this.inbox = [];
    return out;
  }

  async me(): Promise<string> {
    return this.user;
  }

  /** Queue a reply timestamped just after epoch-ms `base`, in arrival order. */
  reply(text: string, base: number, from = this.user): void {
    const n = ++this.seq;
    this.inbox.push({ id: `m${n}`, from, text, at: new Date(base + n).toISOString() });
  }
}
