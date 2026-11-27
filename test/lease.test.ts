import { expect, test } from "bun:test";
import { LEASE_MS, releaseLease, takeLease } from "../plugin/server/lease.ts";
import { MAX_DELAY } from "../plugin/server/poll.ts";
import { freshStore } from "../plugin/server/store.ts";

test("the lease outlasts two slowest poll cycles", () => {
  expect(LEASE_MS).toBe(2 * MAX_DELAY);
});

test("a free lease is taken and stamped", () => {
  const s = freshStore();
  expect(takeLease(s, "/a", 1000)).toBe(true);
  expect(s.lease).toEqual({ owner: "/a", until: 1000 + LEASE_MS });
});

test("another key cannot take an unexpired lease", () => {
  const s = freshStore();
  takeLease(s, "/a", 1000);
  expect(takeLease(s, "/b", 1000 + LEASE_MS - 1)).toBe(false);
  expect(s.lease?.owner).toBe("/a");
});

test("an expired lease can be taken over", () => {
  const s = freshStore();
  takeLease(s, "/a", 1000);
  expect(takeLease(s, "/b", 1000 + LEASE_MS)).toBe(true);
  expect(s.lease?.owner).toBe("/b");
});

test("the holder renews its own lease", () => {
  const s = freshStore();
  takeLease(s, "/a", 1000);
  expect(takeLease(s, "/a", 5000)).toBe(true);
  expect(s.lease?.until).toBe(5000 + LEASE_MS);
});

test("release clears only your own lease", () => {
  const s = freshStore();
  takeLease(s, "/a", 1000);
  releaseLease(s, "/b");
  expect(s.lease?.owner).toBe("/a");
  releaseLease(s, "/a");
  expect(s.lease).toBeNull();
});
