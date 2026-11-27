import { expect, test } from "bun:test";
import { asksForSecret, looksLikeSecret, SENSITIVE_TEXT } from "../plugin/server/sensitive.ts";

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

test("looksLikeSecret leaves ordinary replies alone", () => {
  for (const s of [
    "yes abcde",
    "2",
    "#q1 use last month",
    "status",
    "Exclude archived orders and rerun the export please",
    "https://example.com/a/b/c/d/e",
    "use order 1234567890",
  ]) {
    expect(looksLikeSecret(s)).toBe(false);
  }
});

test("the sensitive notice sends people back to the terminal", () => {
  expect(SENSITIVE_TEXT).toContain("can't be shared over Teams");
});
