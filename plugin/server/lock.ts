// state.lock: one writer at a time across servers. The hook keeps its own copy (hooks import nothing).
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LOCK_STALE_MS = 5_000;
export const LOCK_WAIT_MS = 2_000;

/** Another process held the lock for longer than LOCK_WAIT_MS. */
export class StateBusy extends Error {}

/** The lock file holds its owner's pid. True when that process is gone (EPERM means alive). */
function holderDead(path: string): boolean {
  const pid = Number.parseInt(readFileSync(path, "utf8"), 10);
  if (!(pid > 0)) return false; // Empty or unreadable: fall back to the age rule.
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** Takes the lock in `dir`; returns its path for the caller to remove. */
export function lock(dir: string): string {
  const path = join(dir, "state.lock");
  const give = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      writeFileSync(path, String(process.pid), { flag: "wx" });
      return path;
    } catch {
      try {
        if (holderDead(path) || Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) rmSync(path, { force: true });
      } catch {
        // Gone between the open and the stat: retry at once.
      }
      if (Date.now() > give) throw new StateBusy("Away Mode state is busy; try again.");
      Bun.sleepSync(50);
    }
  }
}
