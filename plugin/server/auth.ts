import { call, form, HttpError, type Json, type Net } from "./http.ts";
import type { SecretStore } from "./secrets.ts";

export interface AuthConfig {
  /** Tenant ID, or `organizations` for the shared Graph tools app. */
  authority: string;
  /** The public sign-in client (on the bot route it is also the bot's app). */
  clientId: string;
  scopes: string;
  /** Bot route only. */
  botSecret?: string;
}

export interface DeviceCode {
  deviceCode: string;
  /** Microsoft's own instruction: the URL and the code to type. */
  message: string;
  interval: number;
  expiresAt: number;
}

export type Auth = ReturnType<typeof createAuth>;

// offline_access is a sign-in scope, not a Graph permission: without it there's no refresh token.
export const BOT_SCOPES = "User.Read Chat.Read TeamsAppInstallation.ReadWriteSelfForUser offline_access";
export const WORKFLOW_SCOPES = "User.Read Chat.Read offline_access";
/** Microsoft Graph Command Line Tools: a public client any tenant user can sign in with. */
export const GRAPH_TOOLS_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const REFRESH = "graph-refresh-token";
const SIGN_IN_AGAIN = new Set(["invalid_grant", "interaction_required"]);

export class SignedOut extends Error {
  constructor() {
    super("Microsoft sign-in has expired or was revoked. Run /away-mode:setup again.");
  }
}

interface Cached {
  token: string;
  expiresAt: number;
}

export function createAuth(cfg: AuthConfig, net: Net, store: SecretStore, now: () => number) {
  const base = `https://login.microsoftonline.com/${cfg.authority}/oauth2/v2.0`;
  let graph: Cached | null = null;
  let bot: Cached | null = null;

  /** Tokens expire a minute early so a request never races the expiry. */
  const cache = (r: Json): Cached => ({
    token: String(r.access_token),
    expiresAt: now() + (Number(r.expires_in) - 60) * 1000,
  });

  /** Refresh tokens rotate: always keep the newest one. */
  async function keep(r: Json): Promise<void> {
    graph = cache(r);
    if (typeof r.refresh_token === "string") await store.set(REFRESH, r.refresh_token);
  }

  async function startDeviceCode(): Promise<DeviceCode> {
    const r = await call(net, `${base}/devicecode`, form({ client_id: cfg.clientId, scope: cfg.scopes }));
    return {
      deviceCode: String(r.device_code),
      message: String(r.message),
      interval: Number(r.interval) || 5,
      expiresAt: now() + Number(r.expires_in) * 1000,
    };
  }

  async function finishDeviceCode(dc: DeviceCode): Promise<void> {
    let interval = dc.interval;
    while (now() < dc.expiresAt) {
      await net.sleep(interval * 1000);
      try {
        const body = form({ grant_type: DEVICE_GRANT, client_id: cfg.clientId, device_code: dc.deviceCode });
        return await keep(await call(net, `${base}/token`, body));
      } catch (e) {
        const code = e instanceof HttpError ? e.body.error : undefined;
        if (code === "authorization_pending") continue;
        if (code === "slow_down") interval += 5; // RFC 8628
        else throw e;
      }
    }
    throw new Error("The sign-in code expired. Run /away-mode:setup again.");
  }

  async function graphToken(): Promise<string> {
    if (graph && graph.expiresAt > now()) return graph.token;
    const refresh = await store.get(REFRESH);
    if (!refresh) throw new SignedOut();
    try {
      const body = form({ grant_type: "refresh_token", client_id: cfg.clientId, refresh_token: refresh, scope: cfg.scopes });
      await keep(await call(net, `${base}/token`, body));
    } catch (e) {
      if (e instanceof HttpError && SIGN_IN_AGAIN.has(String(e.body.error))) {
        await store.delete(REFRESH);
        throw new SignedOut();
      }
      throw e;
    }
    return graph!.token;
  }

  async function botToken(): Promise<string> {
    if (!cfg.botSecret) throw new Error("No bot on this route.");
    if (bot && bot.expiresAt > now()) return bot.token;
    const body = form({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.botSecret,
      scope: "https://api.botframework.com/.default",
    });
    bot = cache(await call(net, `${base}/token`, body));
    return bot.token;
  }

  return { startDeviceCode, finishDeviceCode, graphToken, botToken };
}
