// The owner's own short timer (Graph backoff mustn't delay a second project's replies).
export interface InboxLoop {
  away(): boolean;
  sweep(): Promise<unknown>;
  drain(): Promise<unknown>;
  sleep(ms: number): Promise<void>;
  delay: number;
  fail(what: string): (e: Error) => void;
}

/** One last pass after away flips off sends a terminal recap. */
export async function inboxLoop(l: InboxLoop): Promise<void> {
  for (let on = true; on; ) {
    on = l.away();
    if (!on) await l.sweep().catch(l.fail("expiry")); // so the last pass sees its own expiry
    await l.drain().catch(l.fail("inbox"));
    if (on) await l.sleep(l.delay);
  }
}
