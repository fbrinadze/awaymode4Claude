import { expect, test } from "bun:test";
import { botText, graphChat } from "../plugin/server/adapters/graph-chat.ts";
import { fakeNet } from "./fake-net.ts";

const graphMsg = (id: string, at: string, over: object = {}) => ({
  id, messageType: "message", lastModifiedDateTime: at, createdDateTime: at,
  from: { user: { id: "user-1" }, application: null },
  body: { contentType: "html", content: `<p>${id}</p>` },
  ...over,
});
const card = (...texts: string[]) => ({
  contentType: "application/vnd.microsoft.card.adaptive",
  content: JSON.stringify({
    type: "AdaptiveCard",
    body: [
      { type: "TextBlock", text: texts[0] },
      { type: "RichTextBlock", inlines: texts.slice(1).map((text) => ({ type: "TextRun", text })) },
    ],
  }),
});
const fromApp = { user: null, application: { id: "358f0194-6b0e-4dd3-af35-c24fe8a9ec87" } };
const quote = (id: string) => ({ contentType: "messageReference", content: JSON.stringify({ messageId: id }) });

test("botText reads TextRun and TextBlock text from an Adaptive Card attachment", () => {
  const m = graphMsg("c1", "2026-11-26T18:00:00.000Z", { body: { content: '<attachment id="a"></attachment>' }, attachments: [card("Claude Code · app", "hi")] });
  expect(botText(m)).toBe("Claude Code · app\nhi");
});

async function replyTagFor(cardTexts: string[]) {
  const page = [
    graphMsg("r1", "2026-11-26T18:00:05.000Z", { attachments: [quote("c1")] }),
    graphMsg("c1", "2026-11-26T18:00:03.000Z", { from: fromApp, body: { content: '<attachment id="a"></attachment>' }, attachments: [card(...cardTexts)] }),
  ];
  const { net } = fakeNet([["GET https://graph.microsoft.com/v1.0/chats/", () => ({ value: page })]]);
  const reader = graphChat({ chatId: "19:x", token: async () => "G", net, ours: (t) => t.includes("ref k3x9q2ab") });
  return (await reader.poll("2026-11-26T18:00:00.000Z")).find((m) => m.id === "r1")?.replyTag;
}

test("a card without our ref teaches no tag", async () => {
  expect(await replyTagFor(["Claude Code · app", "Question q1"])).toBeUndefined();
});

test("a card with our ref teaches its tag", async () => {
  expect(await replyTagFor(["Claude Code · app", "Question q1", "ref k3x9q2ab"])).toBe("app");
});
