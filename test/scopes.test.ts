import { expect, test } from "bun:test";
import { extraScopes, grantedScopes } from "../plugin/server/scopes.ts";

const jwt = (p: object) => `h.${Buffer.from(JSON.stringify(p)).toString("base64url")}.s`;

test("extraScopes flags Directory.ReadWrite.All", () => {
  const granted = grantedScopes(jwt({ scp: "User.Read Chat.Read Directory.ReadWrite.All openid" }));
  expect(granted).toEqual(["User.Read", "Chat.Read", "Directory.ReadWrite.All", "openid"]);
  expect(extraScopes(granted)).toEqual(["Directory.ReadWrite.All"]);
  expect(extraScopes(["user.read", "CHAT.READ", "offline_access"])).toEqual([]);
});

test("a bad token gives no scopes", () => {
  expect(grantedScopes("garbage")).toEqual([]);
  expect(grantedScopes("a.!!!.c")).toEqual([]);
  expect(grantedScopes(jwt({}))).toEqual([]);
});
