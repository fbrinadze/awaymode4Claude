import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

/** The slice of Bun.secrets we use, so tests can pass a fake. */
export interface Keychain {
  get(o: { service: string; name: string }): Promise<string | null>;
  set(o: { service: string; name: string; value: string; persist?: "local" | "enterprise" }): Promise<void>;
  delete(o: { service: string; name: string }): Promise<boolean>;
}

const SERVICE = "away-mode";

/**
 * OS keychain first (Credential Manager / Keychain / libsecret). If it fails, or the value
 * is too big (Windows caps a credential at ~2.5 KB), a 0600 file in plugin data.
 * ponytail: on Windows the file mode is a no-op; the user profile ACL is the real guard.
 */
export function secretStore(dir: string, keychain: Keychain = Bun.secrets): SecretStore {
  const file = (name: string) => join(dir, `${name}.secret`);
  const key = (name: string) => ({ service: SERVICE, name });

  async function dropKeychain(name: string): Promise<void> {
    await keychain.delete(key(name)).catch(() => false);
  }

  return {
    async get(name) {
      const fromKeychain = await keychain.get(key(name)).catch(() => null);
      if (fromKeychain) return fromKeychain;
      try {
        return readFileSync(file(name), "utf8") || null;
      } catch {
        return null;
      }
    },
    async set(name, value) {
      try {
        // "local": a refresh token must not roam to the user's other domain machines.
        await keychain.set({ ...key(name), value, persist: "local" });
        rmSync(file(name), { force: true });
      } catch {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file(name), value, { mode: 0o600 });
        await dropKeychain(name);
      }
    },
    async delete(name) {
      await dropKeychain(name);
      rmSync(file(name), { force: true });
    },
  };
}
