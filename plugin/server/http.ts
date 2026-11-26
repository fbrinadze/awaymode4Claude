export type Json = Record<string, unknown>;

/** Network seam: real fetch/setTimeout in production, fakes in tests. */
export interface Net {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  sleep(ms: number): Promise<void>;
}

/** A non-2xx response. `body` is the parsed JSON error, never a token. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Json,
    message: string,
  ) {
    super(message);
  }
}

const describe = (b: Json): string =>
  String((b.error as Json | undefined)?.message ?? b.error_description ?? b.error ?? b.raw ?? "").slice(0, 300);

/** Fetch and parse JSON. One retry after a 429, honouring Retry-After (capped at 60 s). */
export async function call(net: Net, url: string, init: RequestInit = {}): Promise<Json> {
  let res = await net.fetch(url, init);
  if (res.status === 429) {
    await net.sleep(Math.min(Number(res.headers.get("retry-after")) || 5, 60) * 1000);
    res = await net.fetch(url, init);
  }
  const text = await res.text();
  let body: Json;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const { host, pathname } = new URL(url);
    throw new HttpError(res.status, body, `${init.method ?? "GET"} ${host}${pathname} failed (${res.status}): ${describe(body)}`);
  }
  return body;
}

export const form = (data: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(data).toString(),
});

export const bearer = (token: string, method = "GET", body?: unknown): RequestInit => ({
  method,
  headers: {
    authorization: `Bearer ${token}`,
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});
