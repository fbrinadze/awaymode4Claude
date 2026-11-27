// Which project a server or hook belongs to, and the short tag Teams shows for it.
import { basename, dirname, resolve } from "node:path";
import type { Store } from "./store.ts";

/** The project's identity: its resolved path (case-insensitive on Windows). The hook uses the same rule. */
export function projectKey(dir: string): string {
  const key = resolve(dir);
  return process.platform === "win32" ? key.toLowerCase() : key;
}

/** Folder name, or "home" for Claude Code started in the home folder. */
export function baseTag(dir: string, home: string): string {
  return projectKey(dir) === projectKey(home) ? "home" : basename(resolve(dir));
}

/** The tag to show and to match with @: the folder name, or parent/folder when two away projects share it. */
export function tagFor(key: string, s: Store): string {
  const own = s.projects[key]?.tag || basename(key);
  const clash = Object.entries(s.projects).some(
    ([k, p]) => k !== key && p.awayUntil > 0 && (p.tag || basename(k)).toLowerCase() === own.toLowerCase(),
  );
  return clash ? `${basename(dirname(key))}/${own}` : own;
}
