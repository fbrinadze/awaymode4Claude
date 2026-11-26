export const MIN_DELAY = 5_000;
export const MAX_DELAY = 60_000;

export interface Poller {
  /** Fetch and handle new messages; returns how many arrived. */
  fetch(): Promise<number>;
  away(): boolean;
  sleep(ms: number): Promise<void>;
}

/** 5 s right after a message, doubling to 60 s while quiet. */
export const nextDelay = (prev: number, got: boolean): number =>
  got ? MIN_DELAY : Math.min(prev * 2, MAX_DELAY);

/** Poll only while away. A failed poll backs off like a quiet one. */
export async function pollLoop(p: Poller): Promise<void> {
  let delay = MIN_DELAY;
  while (p.away()) {
    let got = 0;
    try {
      got = await p.fetch();
    } catch (e) {
      console.error(`away-mode: poll failed: ${(e as Error).message}`);
    }
    delay = nextDelay(delay, got > 0);
    await p.sleep(delay);
  }
}
