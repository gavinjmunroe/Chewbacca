/**
 * Unit tests for per-tenant encrypted secret store.
 *
 * We inject a stub `SecretsBackend` instead of relying on the global BigQuery
 * mock so each test owns its persisted-row state explicitly. Production code
 * does not see this backend swap — `__setSecretsBackendForTests(null)` after
 * each test restores normal lazy init.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

import {
  getTenantSecret,
  setTenantSecret,
  rotateTenantSecret,
  deleteTenantSecret,
  __resetMasterKeyCacheForTests,
  __setSecretsBackendForTests,
  type SecretsBackend,
} from "../tenantSecrets";

// ── Stub backend ────────────────────────────────────────────────────────────

interface StoredRow {
  tenant_id: string;
  key_name: string;
  ciphertext_b64: string;
  nonce_b64: string;
  auth_tag_b64: string;
  created_at: string;
  rotated_at: string | null;
}

function makeStubBackend() {
  const rows: StoredRow[] = [];
  const calls: Array<{ sql: string; params: Record<string, unknown> }> = [];

  const backend: SecretsBackend = {
    async query({ query, params = {} }) {
      calls.push({ sql: query, params });
      const upper = query.trim().toUpperCase();

      if (upper.startsWith("SELECT")) {
        const tenantId = params.tenant_id as string;
        const keyName = params.key_name as string;
        const match = rows.find(
          (r) => r.tenant_id === tenantId && r.key_name === keyName,
        );
        if (!match) return [[]];
        return [
          [
            {
              ciphertext_b64: match.ciphertext_b64,
              nonce_b64: match.nonce_b64,
              auth_tag_b64: match.auth_tag_b64,
            },
          ],
        ];
      }

      if (upper.startsWith("MERGE")) {
        const tenantId = params.tenant_id as string;
        const keyName = params.key_name as string;
        const existing = rows.findIndex(
          (r) => r.tenant_id === tenantId && r.key_name === keyName,
        );
        const next: StoredRow = {
          tenant_id: tenantId,
          key_name: keyName,
          ciphertext_b64: params.ciphertext_b64 as string,
          nonce_b64: params.nonce_b64 as string,
          auth_tag_b64: params.auth_tag_b64 as string,
          created_at: new Date().toISOString(),
          rotated_at: existing >= 0 ? new Date().toISOString() : null,
        };
        if (existing >= 0) {
          next.created_at = rows[existing].created_at;
          rows[existing] = next;
        } else {
          rows.push(next);
        }
        return [[]];
      }

      if (upper.startsWith("DELETE")) {
        const tenantId = params.tenant_id as string;
        const keyName = params.key_name as string;
        const idx = rows.findIndex(
          (r) => r.tenant_id === tenantId && r.key_name === keyName,
        );
        if (idx >= 0) rows.splice(idx, 1);
        return [[]];
      }

      throw new Error(`unhandled SQL in stub: ${query.slice(0, 60)}...`);
    },
  };

  return { backend, rows, calls };
}

// ── Setup / teardown ────────────────────────────────────────────────────────

const VALID_MASTER_KEY = crypto.randomBytes(32).toString("hex");

beforeEach(() => {
  process.env.TENANT_SECRETS_MASTER_KEY = VALID_MASTER_KEY;
  __resetMasterKeyCacheForTests();
});

afterEach(() => {
  __setSecretsBackendForTests(null);
  __resetMasterKeyCacheForTests();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("tenantSecrets — encryption round-trip", () => {
  it("round-trips a secret end-to-end", async () => {
    const { backend } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    const plaintext = "sk-proj-abc123-this-is-a-fake-openai-key";
    await setTenantSecret("test_tenant", "OPENAI_API_KEY", plaintext);

    const recovered = await getTenantSecret("test_tenant", "OPENAI_API_KEY");
    expect(recovered).toBe(plaintext);
  });

  it("returns null for missing secrets without throwing", async () => {
    const { backend } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    const recovered = await getTenantSecret("test_tenant", "NOT_THERE");
    expect(recovered).toBeNull();
  });

  it("generates a unique nonce per write (same plaintext → different ciphertext)", async () => {
    const { backend, rows } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    await setTenantSecret("test_tenant", "K1", "same-plaintext");
    await setTenantSecret("test_tenant", "K2", "same-plaintext");

    expect(rows).toHaveLength(2);
    expect(rows[0].nonce_b64).not.toBe(rows[1].nonce_b64);
    expect(rows[0].ciphertext_b64).not.toBe(rows[1].ciphertext_b64);
  });

  it("isolates secrets across tenants", async () => {
    const { backend } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    await setTenantSecret("test_tenant", "OPENAI_API_KEY", "key-for-test_tenant");
    await setTenantSecret("amber", "OPENAI_API_KEY", "key-for-amber");

    expect(await getTenantSecret("test_tenant", "OPENAI_API_KEY")).toBe(
      "key-for-test_tenant",
    );
    expect(await getTenantSecret("amber", "OPENAI_API_KEY")).toBe(
      "key-for-amber",
    );
  });
});

describe("tenantSecrets — idempotent set + rotate", () => {
  it("set is idempotent on (tenant_id, key_name)", async () => {
    const { backend, rows } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    await setTenantSecret("test_tenant", "OPENAI_API_KEY", "v1");
    await setTenantSecret("test_tenant", "OPENAI_API_KEY", "v2");
    await setTenantSecret("test_tenant", "OPENAI_API_KEY", "v3");

    expect(rows).toHaveLength(1);
    expect(await getTenantSecret("test_tenant", "OPENAI_API_KEY")).toBe("v3");
  });

  it("rotateTenantSecret behaves identically to setTenantSecret for existing keys", async () => {
    const { backend } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    await setTenantSecret("test_tenant", "OPENAI_API_KEY", "v1");
    await rotateTenantSecret("test_tenant", "OPENAI_API_KEY", "v2");

    expect(await getTenantSecret("test_tenant", "OPENAI_API_KEY")).toBe("v2");
  });

  it("deleteTenantSecret removes a stored row", async () => {
    const { backend, rows } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    await setTenantSecret("test_tenant", "OPENAI_API_KEY", "v1");
    expect(rows).toHaveLength(1);

    await deleteTenantSecret("test_tenant", "OPENAI_API_KEY");
    expect(rows).toHaveLength(0);
    expect(await getTenantSecret("test_tenant", "OPENAI_API_KEY")).toBeNull();
  });

  it("deleteTenantSecret on a missing key is a no-op", async () => {
    const { backend } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    await expect(
      deleteTenantSecret("test_tenant", "NEVER_EXISTED"),
    ).resolves.toBeUndefined();
  });
});

describe("tenantSecrets — auth tag verification", () => {
  it("throws when ciphertext is tampered", async () => {
    const { backend, rows } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    await setTenantSecret("test_tenant", "OPENAI_API_KEY", "real-value");

    // Flip a byte in the ciphertext after-the-fact.
    const ct = Buffer.from(rows[0].ciphertext_b64, "base64");
    ct[0] = ct[0] ^ 0xff;
    rows[0].ciphertext_b64 = ct.toString("base64");

    await expect(getTenantSecret("test_tenant", "OPENAI_API_KEY")).rejects.toThrow(
      /unsupported state|auth/i,
    );
  });

  it("throws when auth tag is tampered", async () => {
    const { backend, rows } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    await setTenantSecret("test_tenant", "OPENAI_API_KEY", "real-value");

    const tag = Buffer.from(rows[0].auth_tag_b64, "base64");
    tag[0] = tag[0] ^ 0xff;
    rows[0].auth_tag_b64 = tag.toString("base64");

    await expect(
      getTenantSecret("test_tenant", "OPENAI_API_KEY"),
    ).rejects.toThrow();
  });

  it("throws when master key changes between write and read", async () => {
    const { backend } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    await setTenantSecret("test_tenant", "OPENAI_API_KEY", "real-value");

    // Rotate the master key out from under the encrypted row.
    process.env.TENANT_SECRETS_MASTER_KEY = crypto
      .randomBytes(32)
      .toString("hex");
    __resetMasterKeyCacheForTests();

    await expect(
      getTenantSecret("test_tenant", "OPENAI_API_KEY"),
    ).rejects.toThrow();
  });
});

describe("tenantSecrets — master key validation", () => {
  it("throws a clear error when TENANT_SECRETS_MASTER_KEY is unset", async () => {
    const { backend } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    delete process.env.TENANT_SECRETS_MASTER_KEY;
    __resetMasterKeyCacheForTests();

    await expect(setTenantSecret("test_tenant", "K", "v")).rejects.toThrow(
      /TENANT_SECRETS_MASTER_KEY is required/i,
    );
  });

  it("throws when TENANT_SECRETS_MASTER_KEY is the wrong length", async () => {
    const { backend } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    process.env.TENANT_SECRETS_MASTER_KEY = "abc123"; // far too short
    __resetMasterKeyCacheForTests();

    await expect(setTenantSecret("test_tenant", "K", "v")).rejects.toThrow(
      /64 hex chars/i,
    );
  });

  it("throws when TENANT_SECRETS_MASTER_KEY has non-hex characters", async () => {
    const { backend } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    // 64 chars but not hex.
    process.env.TENANT_SECRETS_MASTER_KEY = "z".repeat(64);
    __resetMasterKeyCacheForTests();

    await expect(setTenantSecret("test_tenant", "K", "v")).rejects.toThrow(
      /64 hex chars/i,
    );
  });

  it("rejects empty inputs at the API boundary", async () => {
    const { backend } = makeStubBackend();
    __setSecretsBackendForTests(backend);

    await expect(setTenantSecret("", "K", "v")).rejects.toThrow(/tenantId/i);
    await expect(setTenantSecret("test_tenant", "", "v")).rejects.toThrow(
      /keyName/i,
    );
    await expect(setTenantSecret("test_tenant", "K", "")).rejects.toThrow(
      /plaintext/i,
    );
  });
});
