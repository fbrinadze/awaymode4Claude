// `more <id>`: a long command is sent in parts, and only then can it be approved (spec 6.2).
import type { DeliverEnv } from "./deliver.ts";

export const MORE_PART = 1_000;
export const MORE_MAX_PARTS = 5;

export async function more(e: DeliverEnv, id: string): Promise<void> {
  const perm = e.current().permissions.find((p) => p.id === id);
  if (!perm?.needsMore || perm.preview === undefined || (perm.instance !== undefined && perm.instance !== e.instance)) {
    return e.say("That request is no longer waiting.");
  }
  // Each part must arrive whole: what's cut off at the cap would be approved unseen. "(5/5) " is the counter.
  const size = Math.min(MORE_PART, (e.room ?? Infinity) - "(5/5) ".length);
  const n = size > 0 ? Math.ceil(perm.preview.length / size) : Infinity;
  if (n > MORE_MAX_PARTS) return e.say("Too long for Teams. Approve it at the terminal.");
  for (let i = 0; i < n; i++) await e.say(`(${i + 1}/${n}) ${perm.preview.slice(i * size, (i + 1) * size)}`, "approval");
  e.update((s) => void (s.permissions.find((p) => p.id === id)!.moreSent = true));
}
