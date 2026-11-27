import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { baseTag, projectKey, tagFor } from "../plugin/server/project.ts";
import { freshProject, freshStore } from "../plugin/server/store.ts";

test("the same folder always gets the same key", () => {
  if (process.platform === "win32") expect(projectKey("C:/A/b/")).toBe(projectKey("c:\\a\\b"));
  expect(projectKey("/x/y/../y")).toBe(projectKey("/x/y"));
});

test("the home folder is tagged home, others by folder name", () => {
  expect(baseTag(homedir(), homedir())).toBe("home");
  expect(baseTag(join(homedir(), "order-portal"), homedir())).toBe("order-portal");
});

test("tags stay unique among away projects", () => {
  const s = freshStore();
  const away = (tag: string) => ({ ...freshProject(tag), awayUntil: 1 });
  s.projects[projectKey("/x/api")] = away("api");
  expect(tagFor(projectKey("/x/api"), s)).toBe("api");
  s.projects[projectKey("/y/api")] = away("api");
  expect(tagFor(projectKey("/x/api"), s)).toBe("x/api");
  expect(tagFor(projectKey("/y/api"), s)).toBe("y/api");
});

test("a clashing parent/folder grows another path segment", () => {
  const s = freshStore();
  const away = (tag: string) => ({ ...freshProject(tag), awayUntil: 1 });
  s.projects[projectKey("/a/x/app")] = away("app");
  s.projects[projectKey("/b/x/app")] = away("app");
  s.projects[projectKey("/c/y/app")] = away("app");
  expect(tagFor(projectKey("/a/x/app"), s)).toBe("a/x/app");
  expect(tagFor(projectKey("/b/x/app"), s)).toBe("b/x/app");
  expect(tagFor(projectKey("/c/y/app"), s)).toBe("y/app");
});
