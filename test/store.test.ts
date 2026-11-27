import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStore, StateBusy, withStore } from "../plugin/server/store.ts";

const T = Date.parse("2026-11-27T18:00:00Z");
const dir = () => mkdtempSync(join(tmpdir(), "away-store-"));
const put = (d: string, v: unknown) => writeFileSync(join(d, "state.json"), typeof v === "string" ? v : JSON.stringify(v));

test("a missing or corrupt file loads as an empty, unpaired store", () => {
  const d = dir();
  expect(readStore(d, T).me).toBe("");
  expect(readStore(d, T).projects).toEqual({});
  put(d, "{not json");
  expect(readStore(d, T).me).toBe("");
});

test("wrong-typed fields fall back field by field", () => {
  const d = dir();
  put(d, { version: 2, me: "u", projects: { "/p": { tag: "p", permissions: null, awayUntil: "x", questions: [{ id: "q1" }] } } });
  const s = readStore(d, T);
  expect(s.me).toBe("u");
  // Wrong types fall back; a project with an open question is kept, not pruned.
  expect(s.projects["/p"]!.permissions).toEqual([]);
  expect(s.projects["/p"]!.awayUntil).toBe(0);
});

test("a v1 file migrates into a project and keeps the pairing", () => {
  const d = dir();
  const q = { id: "q1", text: "?", options: [] };
  const p = { id: "abcde", tool: "Bash", at: T };
  put(d, { me: "u", cursor: "C", nextQ: 4, awayUntil: T + 1e6, questions: [q], permissions: [p] });
  const s = readStore(d, T, { key: "/p", tag: "p" });
  expect(s.me).toBe("u");
  expect(s.cursor).toBe("C");
  expect(s.nextQ).toBe(4);
  expect(s.projects["/p"]!.awayUntil).toBe(T + 1e6);
  expect(s.projects["/p"]!.questions).toEqual([]);
  expect(s.projects["/p"]!.permissions).toEqual([]);
});

test("idle projects with nothing pending are pruned", () => {
  const d = dir();
  put(d, { version: 2, me: "u", projects: { "/gone": { tag: "gone", awayUntil: 0 }, "/live": { tag: "live", awayUntil: T + 1e6 } } });
  const s = readStore(d, T);
  expect(Object.keys(s.projects)).toEqual(["/live"]);
});

test("writes are 0600 and atomic, and release the lock", () => {
  const d = dir();
  withStore(d, T, (s) => void (s.me = "u"));
  expect(readStore(d, T).me).toBe("u");
  if (process.platform !== "win32") expect(statSync(join(d, "state.json")).mode & 0o777).toBe(0o600);
  expect(readdirSync(d).filter((f) => f.endsWith(".tmp") || f === "state.lock")).toEqual([]);
});

test("a stale lock is removed", () => {
  const d = dir();
  const lock = join(d, "state.lock");
  writeFileSync(lock, "");
  const old = (Date.now() - 6_000) / 1000;
  utimesSync(lock, old, old);
  expect(withStore(d, T, (s) => (s.me = "u"))).toBe("u");
  expect(existsSync(lock)).toBe(false);
});

test("a fresh lock is waited for, then reported", () => {
  const d = dir();
  writeFileSync(join(d, "state.lock"), "");
  const start = Date.now();
  expect(() => withStore(d, T, () => {})).toThrow(StateBusy);
  const waited = Date.now() - start;
  expect(waited).toBeGreaterThanOrEqual(1_500);
  expect(waited).toBeLessThan(3_000);
});
