import { expect, test } from "bun:test";
import type { Kind } from "../plugin/server/adapters/adapter.ts";
import { buildCard, cardMessage } from "../plugin/server/adapters/card.ts";

type El = { type: string; text?: string; inlines?: El[]; fontType?: string; weight?: string; color?: string; isSubtle?: boolean };
const body = (c: Record<string, unknown>) => c.body as El[];
const runs = (c: Record<string, unknown>) => body(c).find((e) => e.type === "RichTextBlock")!.inlines!;

test("header names Claude Code and the project", () => {
  const h = body(buildCard("hi", { project: "awaymode", kind: "reply" }, "k3x9q2ab"))[0]!;
  expect(h).toMatchObject({ type: "TextBlock", text: "Claude Code · awaymode", weight: "Bolder", color: "Accent" });
});

test("no project: header is Claude Code", () => {
  expect(body(buildCard("hi", undefined, "r"))[0]!.text).toBe("Claude Code");
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

test("approval command line is monospace", () => {
  const c = buildCard('Permission needed\nBash: run tests\nbun test\nReply "yes abcde"', { kind: "approval" }, "r");
  const r = runs(c).filter((x) => x.type === "TextRun");
  expect(r.find((x) => x.text === "bun test")!.fontType).toBe("Monospace");
  expect(r.find((x) => x.text === "Permission needed")!.fontType).toBeUndefined();
});

test("ref footer is last", () => {
  const last = body(buildCard("hi", {}, "k3x9q2ab")).at(-1)!;
  expect(last).toMatchObject({ type: "TextBlock", text: "ref k3x9q2ab", isSubtle: true });
});

test("cardMessage wraps the card as an Adaptive Card attachment", () => {
  const m = cardMessage({ type: "AdaptiveCard" });
  expect(m).toEqual({ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { type: "AdaptiveCard" } }] });
});
