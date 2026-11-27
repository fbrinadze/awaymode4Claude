// Secrets never cross Teams: Claude may not ask for one, and a reply that looks like one is held back.

export const SENSITIVE_TEXT =
  "Sensitive request\nClaude needs information that can't be shared over Teams.\nPlease go back to your Claude Code session to continue.";

/** Sent instead of passing a secret-looking reply to Claude. */
export const HELD_BACK_TEXT =
  "That looked like a password or key, so it wasn't passed on to Claude. Enter it in Claude Code instead, and consider rotating it.";

const REQUEST = /\b(send|give|enter|paste|share|provide|type|tell me|what'?s|what is)\b/i;
const SECRET_NOUN =
  /\b(password|passcode|passphrase|pin|api key|access key|token|secret|private key|connection string|one[- ]time code|otp|mfa code|2fa code|verification code|card number|credit card|cvv)\b/i;

/** Asks the user for a credential: request wording together with a secret noun. When unsure, block. */
export function asksForSecret(text: string): boolean {
  return REQUEST.test(text) && SECRET_NOUN.test(text);
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
