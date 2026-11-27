const EXPECTED = new Set(["user.read", "chat.read", "openid", "profile", "email", "offline_access"]);

/** The scopes a Graph access token actually carries (its `scp` claim); unreadable token → none. */
export function grantedScopes(accessToken: string): string[] {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { scp?: unknown };
    return typeof payload.scp === "string" ? payload.scp.split(" ").filter(Boolean) : [];
  } catch {
    return []; // not a JWT (or not JSON): treat as "no scopes known"
  }
}

/** Anything beyond what Away Mode needs, so setup and doctor can warn about an over-broad sign-in app. */
export function extraScopes(granted: string[]): string[] {
  return granted.filter((s) => !EXPECTED.has(s.toLowerCase()));
}
