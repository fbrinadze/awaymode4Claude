import type { Net } from "../plugin/server/http.ts";
import type { SecretStore } from "../plugin/server/secrets.ts";

export interface Req {
  method: string;
  url: URL;
  body: string;
  auth?: string;
}

/** A handler returns JSON (sent as 200) or a full Response. */
type Handler = (req: Req) => unknown;

/** Routes match `"<METHOD> <url without query>"` by substring. Unmatched requests 404. */
export function fakeNet(routes: [string, Handler][], onSleep: (ms: number) => void = () => {}) {
  const calls: Req[] = [];
  const slept: number[] = [];
  const net: Net = {
    async fetch(u, init = {}) {
      const url = new URL(u);
      const headers = (init.headers ?? {}) as Record<string, string>;
      const req: Req = { method: init.method ?? "GET", url, body: String(init.body ?? ""), auth: headers.authorization };
      calls.push(req);
      const key = `${req.method} ${url.origin}${url.pathname}`;
      const hit = routes.find(([p]) => key.includes(p));
      if (!hit) return Response.json({ error: { message: `no route for ${key}` } }, { status: 404 });
      const out = hit[1](req);
      return out instanceof Response ? out : Response.json(out);
    },
    async sleep(ms) {
      slept.push(ms);
      onSleep(ms);
    },
  };
  return { net, calls, slept };
}

/** Form-encoded request body as an object. */
export const formOf = (r: Req) => Object.fromEntries(new URLSearchParams(r.body));

export function memoryStore(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
}
