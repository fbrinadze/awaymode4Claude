import { expect, test } from "bun:test";
import { createAuth, SignedOut } from "../plugin/server/auth.ts";
import { fakeNet, formOf, memoryStore } from "./fake-net.ts";

const cfg = { tenantId: "tid", clientId: "app", botSecret: "s3cret" };
const err = (error: string) => Response.json({ error, error_description: `${error} happened` }, { status: 400 });
const tokens = (n: number) => ({ access_token: `at${n}`, refresh_token: `rt${n}`, expires_in: 3600 });

test("device code: waits through pending and slow_down, then keeps the refresh token", async () => {
  const answers = [err("authorization_pending"), err("slow_down"), tokens(1)];
  const { net, calls, slept } = fakeNet([
    ["POST https://login.microsoftonline.com/tid/oauth2/v2.0/devicecode", () => ({
      device_code: "dc", message: "Go to https://microsoft.com/devicelogin and enter ABCD", interval: 1, expires_in: 900,
    })],
    ["/oauth2/v2.0/token", () => answers.shift()],
  ]);
  const store = memoryStore();
  const auth = createAuth(cfg, net, store, () => 0);
  const dc = await auth.startDeviceCode();
  expect(dc.message).toContain("ABCD");
  await auth.finishDeviceCode(dc);
  expect(slept).toEqual([1000, 1000, 6000]);
  expect(store.data.get("graph-refresh-token")).toBe("rt1");
  expect(await auth.graphToken()).toBe("at1"); // cached: no extra request
  expect(calls).toHaveLength(4);
  expect(formOf(calls[0]!).scope).toContain("offline_access"); // no refresh token without it
  expect(formOf(calls[1]!).client_secret).toBeUndefined(); // public client: the bot secret never signs a user in
});

test("device code gives up when the code expires, and stops on decline", async () => {
  let t = 0;
  const { net } = fakeNet(
    [
      ["/devicecode", () => ({ device_code: "dc", message: "m", interval: 5, expires_in: 12 })],
      ["/token", () => err("authorization_pending")],
    ],
    (ms) => (t += ms),
  );
  const auth = createAuth(cfg, net, memoryStore(), () => t);
  await expect(auth.finishDeviceCode(await auth.startDeviceCode())).rejects.toThrow("expired");

  const declined = createAuth(cfg, fakeNet([["/token", () => err("authorization_declined")]]).net, memoryStore(), () => 0);
  const dc = { deviceCode: "dc", message: "m", interval: 1, expiresAt: 1e9 };
  await expect(declined.finishDeviceCode(dc)).rejects.toThrow("authorization_declined");
});

test("refresh tokens rotate: the newest one is stored and used next", async () => {
  let n = 0;
  let t = 0;
  const { net, calls } = fakeNet([["/token", () => tokens(++n)]]);
  const store = memoryStore();
  await store.set("graph-refresh-token", "rt0");
  const auth = createAuth(cfg, net, store, () => t);
  expect(await auth.graphToken()).toBe("at1");
  t += 3_600_000; // past expiry
  expect(await auth.graphToken()).toBe("at2");
  expect(calls.map((c) => formOf(c).refresh_token)).toEqual(["rt0", "rt1"]);
  expect(store.data.get("graph-refresh-token")).toBe("rt2");
});

test("a revoked refresh token means sign in again, and clears it", async () => {
  const store = memoryStore();
  await store.set("graph-refresh-token", "rt0");
  const auth = createAuth(cfg, fakeNet([["/token", () => err("invalid_grant")]]).net, store, () => 0);
  await expect(auth.graphToken()).rejects.toBeInstanceOf(SignedOut);
  expect(store.data.size).toBe(0);
  await expect(auth.graphToken()).rejects.toThrow("/away-mode:setup");
});

test("bot token: client credentials for the Bot Framework, cached", async () => {
  const { net, calls } = fakeNet([["POST https://login.microsoftonline.com/tid/oauth2/v2.0/token", () => tokens(9)]]);
  const auth = createAuth(cfg, net, memoryStore(), () => 0);
  expect(await auth.botToken()).toBe("at9");
  expect(await auth.botToken()).toBe("at9");
  expect(calls).toHaveLength(1);
  expect(formOf(calls[0]!)).toMatchObject({
    grant_type: "client_credentials",
    client_secret: "s3cret",
    scope: "https://api.botframework.com/.default",
  });
});
