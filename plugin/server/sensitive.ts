// Secrets never cross Teams: Claude may not ask for one, and a reply that looks like one is held back.

export const SENSITIVE_TEXT =
  "Sensitive request\nClaude needs information that can't be shared over Teams.\nPlease go back to your Claude Code session to continue.";

/** Sent instead of passing a secret-looking reply to Claude. */
export const HELD_BACK_TEXT =
  "That looked like a password or key, so it wasn't passed on to Claude. Enter it in Claude Code instead, and consider rotating it.";

const NOUN =
  "(?:password|passcode|passphrase|pin|api key|access key|token|secret|private key|connection string|one[- ]time code|otp|mfa code|2fa code|verification code|card number|credit card|cvv)";
// The noun must be the thing asked for: not part of "secret-scanning", "token format", "PIN field"...
const NOT_A_MODIFIER = "(?![-\\w])(?!\\s+(?:format|storage|limit|field|config|name|length|policy|rotation|expiry|type|reset|scanning)\\b)";
/** "send me your API key", "enter the MFA code", "paste the connection string" */
const HAND_OVER = new RegExp(
  `\\b(?:send|give|paste|share|provide|enter|type in|tell me)\\s+(?:me\\s+|us\\s+)?(?:your|the|a|an|my)?\\s*(?:\\w+\\s+)?${NOUN}${NOT_A_MODIFIER}`,
  "i",
);
/** "What's the database password?" — the noun ends the question. */
const WHAT_IS = new RegExp(`\\bwhat(?:'?s| is)\\s+(?:your|the|my)\\s+(?:\\w+\\s+)?${NOUN}\\s*\\??\\s*$`, "i");

/** Asks the user to hand over a credential, not merely mentions one. */
export function asksForSecret(text: string): boolean {
  return HAND_OVER.test(text) || WHAT_IS.test(text);
}

const KNOWN = [
  /\bsk-[A-Za-z0-9_-]{20,}/, // OpenAI/Anthropic-style keys
  /\bgh[pousr]_[A-Za-z0-9]{30,}/, // GitHub tokens
  /\bxox[abpr]-[A-Za-z0-9-]+/, // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key IDs
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/, // JWTs
  /-----BEGIN [A-Z ]+-----/, // PEM blocks
];

/** A long run of mixed-case letters and digits, the shape of generated keys. */
const randomLooking = (word: string): boolean =>
  word.length >= 32 && /^[\w+/=-]+$/.test(word) && /\d/.test(word) && /[a-z]/.test(word) && /[A-Z]/.test(word);

/** A reply that looks like a credential. Never passed to Claude. */
export function looksLikeSecret(text: string): boolean {
  return KNOWN.some((r) => r.test(text)) || text.split(/\s+/).some(randomLooking);
}

/** Outgoing text with key- and token-shaped parts replaced, so a command or note can't carry one to Teams. */
export function redact(text: string): string {
  const known = KNOWN.reduce((t, r) => t.replace(new RegExp(r.source, "g"), "[redacted]"), text);
  return known.replace(/[\w+/=-]{32,}/g, (w) => (randomLooking(w) ? "[redacted]" : w));
}
