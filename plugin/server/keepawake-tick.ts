// Each inbox tick: hold the PC awake while this instance owns a project on vacation, release when the last one ends.
import type { KeepAwake } from "./keepawake.ts";
import { withStore } from "./store.ts";

export const LAPTOP_NOTE = "On a laptop: keep the lid open, or set 'When I close the lid: Do nothing' while plugged in.";
const RETRY_MS = 5 * 60_000; // a hold that didn't take is tried again this often, not on every tick

export interface KeepTick {
  dir: string;
  instance: string;
  now(): number;
  ka: KeepAwake;
  isLaptop(): boolean;
  say(text: string): Promise<unknown>;
}

const wanted = (t: KeepTick): boolean =>
  withStore(t.dir, t.now(), (s) =>
    Object.values(s.projects).some((p) => p.vacation && p.ownerInstance === t.instance && p.awayUntil > t.now()));

export function keepAwakeTick(t: KeepTick): () => Promise<void> {
  let noted = false, retryAt = 0; // per vacation period: reset when the last vacation ends
  return async () => {
    if (!wanted(t)) {
      noted = false; retryAt = 0;
      return t.ka.held() ? t.ka.release() : undefined;
    }
    if (t.ka.held() || t.now() < retryAt) return;
    const laptop = t.isLaptop(); // laptops keep the screen on too; desktops let it turn off
    t.ka.hold(laptop);
    if (!t.ka.held()) { retryAt = t.now() + RETRY_MS; return; }
    if (laptop && !noted) { noted = true; await t.say(LAPTOP_NOTE); }
  };
}
