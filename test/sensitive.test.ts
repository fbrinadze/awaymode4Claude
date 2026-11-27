import { expect, test } from "bun:test";
import { asksForSecret, looksLikeSecret, redact, SENSITIVE_TEXT } from "../plugin/server/sensitive.ts";

test("asksForSecret catches requests for credentials", () => {
  for (const q of [
    "What's the database password?",
    "Please send your API key",
    "Enter the MFA code",
    "paste the connection string",
    "What is the card number?",
    "Can you give me the private key?",
  ]) {
    expect(asksForSecret(q)).toBe(true);
  }
});

test("asksForSecret ignores ordinary questions, even about tokens", () => {
  for (const q of [
    "Include archived orders?",
    "Which token format do you prefer, JWT or opaque?",
    "Should the password reset page show a captcha?",
    "What type of token storage do you prefer: cookies or localStorage?",
    "What is the max token limit for the summarizer?",
    "Should I share the secret-scanning config with the CI job?",
    "Which type should the PIN field be, string or number?",
    "What is the name of the env var for the API key?",
    "Please share the token format you want.",
  ]) {
    expect(asksForSecret(q)).toBe(false);
  }
});

test("looksLikeSecret catches keys, tokens and private keys", () => {
  for (const s of [
    `sk-${"a1B2".repeat(6)}`,
    `ghp_${"x".repeat(36)}`,
    "AKIAABCDEFGHIJKLMNOP",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXZhbHVl",
    "-----BEGIN PRIVATE KEY-----\nMIIE...",
    "here it is: Zx9Qk2Lm8Pw4Rt7Yv1Nb5Hc3Jd6Fg0Ws2Ea",
  ]) {
    expect(looksLikeSecret(s)).toBe(true);
  }
});

test("looksLikeSecret catches a key wrapped in quotes, punctuation or a label", () => {
  const k = "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4Z";
  for (const s of [`token "${k}"`, `here: ${k}.`, `key:${k}`, `(${k})`, `'${k}',`, "Abc8Q~dEf6hIj9kLm2nOp5qRs8tUv1wXy4Z.x7"]) {
    expect(looksLikeSecret(s)).toBe(true);
  }
});

test("looksLikeSecret leaves ordinary replies alone", () => {
  for (const s of [
    "yes abcde",
    "2",
    "#q1 use last month",
    "status",
    "Exclude archived orders and rerun the export please",
    "https://example.com/a/b/c/d/e",
    "use order 1234567890",
    "C:/Users/fbrinadze/projects/awaymode/plugin/server",
    "Please rename OrderExportService.ts to OrderExport.ts",
  ]) {
    expect(looksLikeSecret(s)).toBe(false);
  }
});

test("redact hides keys and tokens in outgoing text, leaving the rest", () => {
  const out = redact('curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl" https://api.example.com');
  expect(out).not.toContain("eyJ");
  expect(out).toContain("[redacted]");
  expect(out).toContain("https://api.example.com");
  expect(redact(`export OPENAI_API_KEY=sk-${"a1B2".repeat(6)}`)).toBe("export OPENAI_API_KEY=[redacted]");
  expect(redact("Bash: npm run migrate")).toBe("Bash: npm run migrate");
});

test("the sensitive notice sends people back to the terminal", () => {
  expect(SENSITIVE_TEXT).toContain("can't be shared over Teams");
});
