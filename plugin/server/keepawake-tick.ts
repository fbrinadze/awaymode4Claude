// Each inbox tick: hold the PC awake while this instance owns a project on vacation, release when the last one ends.
import type { KeepAwake } from "./keepawake.ts";
import { withStore } from "./store.ts";

export const LAPTOP_NOTE = "On a laptop: keep the lid open, or set 'When I close the lid: Do nothing' while plugged in.";

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
  return async () => {
    const want = wanted(t);
    if (want === t.ka.held()) return;
    if (!want) return t.ka.release();
    t.ka.hold(false);
    if (t.isLaptop()) await t.say(LAPTOP_NOTE);
  };
}
