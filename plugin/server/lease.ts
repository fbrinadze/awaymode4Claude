// One server at a time polls Graph; the rest read their inbox. The lease lives in state.json.
import { MAX_DELAY } from "./poll.ts";
import type { Store } from "./store.ts";

export const LEASE_MS = 2 * MAX_DELAY;

/** True if the lease is free, expired or already ours; then it is ours until now + LEASE_MS. */
export function takeLease(s: Store, key: string, now: number): boolean {
  if (s.lease && s.lease.owner !== key && s.lease.until > now) return false;
  s.lease = { owner: key, until: now + LEASE_MS };
  return true;
}

export function releaseLease(s: Store, key: string): void {
  if (s.lease?.owner === key) s.lease = null;
}
