// Which project a server or hook belongs to, and the short tag Teams shows for it.
import { basename, resolve } from "node:path";
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
  const others = Object.entries(s.projects).filter(([k, p]) => k !== key && p.awayUntil > 0);
  const segs = (k: string) => k.split(/[\\/]+/).filter(Boolean);
  // The tag with its n-1 nearest parent folders in front; n=1 is the plain tag.
  const grown = (k: string, own: string, n: number) => (n === 1 ? own : [...segs(k).slice(-n, -1), own].join("/"));
  const own = s.projects[key]?.tag || basename(key);
  for (let n = 1; n < segs(key).length; n++) {
    const mine = grown(key, own, n).toLowerCase();
    if (!others.some(([k, p]) => grown(k, p.tag || basename(k), n).toLowerCase() === mine)) return grown(key, own, n);
  }
  return segs(key).join("/");
}
