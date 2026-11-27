import { expect, test } from "bun:test";
import type { Kind } from "../plugin/server/adapters/adapter.ts";
import { buildCard, cardMessage, hasMarker } from "../plugin/server/adapters/card.ts";

type El = { type: string; text?: string; inlines?: El[]; fontType?: string; weight?: string; color?: string; isSubtle?: boolean };
const body = (c: Record<string, unknown>) => c.body as El[];
const runs = (c: Record<string, unknown>) => body(c)[2]!.inlines!;

const header = (c: Record<string, unknown>) => body(c)[0]!.inlines![0]!;

test("header names Claude Code and the project, as a literal TextRun", () => {
  const h = header(buildCard("hi", { project: "awaymode", kind: "reply" }, "k3x9q2ab"));
  expect(h).toMatchObject({ type: "TextRun", text: "Claude Code · awaymode", weight: "Bolder", color: "Accent" });
});

test("a project name with markdown characters is never put in a TextBlock", () => {
  const c = buildCard("hi", { project: "_x_*y*" }, "r");
  expect(header(c).text).toBe("Claude Code · _x_*y*");
  expect(body(c).some((e) => e.type === "TextBlock" && e.text?.includes("_x_"))).toBe(false);
});

test("no project: header is Claude Code", () => {
  expect(header(buildCard("hi", undefined, "r")).text).toBe("Claude Code");
});

test("subtitle per kind", () => {
  const labels: Record<Kind, string> = {
    question: "Question", approval: "Approval needed", done: "Done", error: "Error",
    update: "Update", recap: "Recap", setup: "Setup", reply: "Reply",
  };
  for (const [kind, label] of Object.entries(labels)) {
    const sub = body(buildCard("x", { kind: kind as Kind }, "r"))[1]!;
    expect(sub).toMatchObject({ type: "TextBlock", text: `Away Mode · ${label}`, isSubtle: true });
  }
});

test("the [Claude · x] prefix is stripped", () => {
  expect(runs(buildCard("[Claude · app] Got it.", { project: "app" }, "r"))[0]!.text).toBe("Got it.");
});

test("special characters stay literal, never in a markdown TextBlock", () => {
  const text = "rm -rf * <a> & [x](y) _u_ \\";
  const c = buildCard(text, { kind: "reply" }, "r");
  expect(runs(c).map((r) => r.text)).toContain(text);
  expect(body(c).filter((e) => e.type === "TextBlock").some((e) => e.text === text)).toBe(false);
});

test("the command named in meta.code is monospace, wherever it sits", () => {
  const text = 'Permission needed\nBash: run\nthe tests\nbun test\n  --watch\nReply "yes abcde"';
  const c = buildCard(text, { kind: "approval", code: "bun test\n  --watch" }, "r");
  const r = runs(c).filter((x) => x.type === "TextRun" && x.text !== "\n");
  expect(r.find((x) => x.text === "bun test")!.fontType).toBe("Monospace");
  expect(r.find((x) => x.text === "  --watch")!.fontType).toBe("Monospace");
  expect(r.find((x) => x.text === "the tests")!.fontType).toBeUndefined();
  expect(r.find((x) => x.text === "Permission needed")!.fontType).toBeUndefined();
});

test("no code: nothing is monospace", () => {
  const c = buildCard("Terminal-only approval\nBash is waiting\nx", { kind: "approval" }, "r");
  expect(runs(c).some((x) => x.fontType)).toBe(false);
});

test("the ref is the header's id and is never shown", () => {
  const c = buildCard("hi", { project: "p" }, "k3x9q2ab");
  expect(body(c)[0]!).toMatchObject({ id: "away-k3x9q2ab" });
  expect(JSON.stringify(c).match(/k3x9q2ab/g)).toHaveLength(1);
  expect(hasMarker([{ contentType: "application/vnd.microsoft.card.adaptive", content: JSON.stringify(c) }], "k3x9q2ab")).toBe(true);
  expect(hasMarker([{ contentType: "application/vnd.microsoft.card.adaptive", content: '{"body":[{"type":"TextBlock","text":"away-k3x9q2ab"}]}' }], "k3x9q2ab")).toBe(false);
});

test("cardMessage wraps the card as an Adaptive Card attachment", () => {
  const m = cardMessage({ type: "AdaptiveCard" });
  expect(m).toEqual({ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { type: "AdaptiveCard" } }] });
});
