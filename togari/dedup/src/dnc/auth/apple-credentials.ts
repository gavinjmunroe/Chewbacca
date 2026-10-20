/**
 * Per-user Apple CardDAV credentials store.
 *
 * Apple's CardDAV does not have OAuth — the only auth is HTTP Basic with
 * the user's iCloud email + an app-specific password they generate at
 * https://appleid.apple.com.
 *
 * We persist these in GCP Secret Manager under:
 *   apple-carddav-{userId}
 *
 * Why Secret Manager and not BQ:
 *   - Same store the rest of the OAuth tokens use (consistency)
 *   - Encrypted at rest, IAM-scoped, no app-side encryption needed
 *   - Cheaper than running our own crypto for a low-volume secret
 *
 * Never read the raw password into a log statement, never return it from
 * a route handler, never put it in a 4xx error body.
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const PROJECT = process.env.GCP_PROJECT_ID ?? "midyear-glazing-485303-u3";

export interface AppleCredentials {
  /** Auth0 sub — the owner_id used everywhere else in the dedupe system */
  userId: string;
  /** iCloud email (e.g. "user@icloud.com") */
  username: string;
  /** App-specific password (treat as a secret, never log) */
  password: string;
  /** ISO timestamp the user connected */
  connected_at: string;
  /** href of the default address book discovered at connect time */
  default_addressbook_href: string | null;
}

let _client: SecretManagerServiceClient | null = null;

function getClient(): SecretManagerServiceClient {
  if (!_client) _client = new SecretManagerServiceClient();
  return _client;
}

function secretName(userId: string): string {
  const safeId = userId.replace(/[^a-zA-Z0-9]/g, "-");
  return `apple-carddav-${safeId}`;
}

function secretPath(name: string): string {
  return `projects/${PROJECT}/secrets/${name}`;
}

/** Persist Apple credentials for a user. Creates the secret if it doesn't exist. */
export async function saveAppleCredentials(
  creds: AppleCredentials,
): Promise<void> {
  const client = getClient();
  const name = secretName(creds.userId);
  const path = secretPath(name);
  const payload = Buffer.from(JSON.stringify(creds));

  try {
    await client.addSecretVersion({
      parent: path,
      payload: { data: payload },
    });
    console.log(`[AppleCreds] Updated for ${creds.userId}`);
    return;
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code !== 5) throw err;
  }

  await client.createSecret({
    parent: `projects/${PROJECT}`,
    secretId: name,
    secret: {
      replication: { automatic: {} },
      labels: { platform: "apple", managed_by: "togari-dnc" },
    },
  });

  await client.addSecretVersion({
    parent: path,
    payload: { data: payload },
  });

  console.log(`[AppleCreds] Created for ${creds.userId}`);
}

/** Fetch the credentials for a user. Returns null if not connected. */
export async function getAppleCredentials(
  userId: string,
): Promise<AppleCredentials | null> {
  const client = getClient();
  const name = secretName(userId);

  try {
    const [version] = await client.accessSecretVersion({
      name: `${secretPath(name)}/versions/latest`,
    });
    const data = version.payload?.data;
    if (!data) return null;
    const raw = typeof data === "string" ? data : Buffer.from(data).toString();
    return JSON.parse(raw) as AppleCredentials;
  } catch {
    return null;
  }
}

/** Disconnect Apple — delete the credentials secret. */
export async function deleteAppleCredentials(userId: string): Promise<void> {
  const client = getClient();
  const name = secretName(userId);
  try {
    await client.deleteSecret({ name: secretPath(name) });
    console.log(`[AppleCreds] Deleted for ${userId}`);
  } catch {
    // Already gone — fine
  }
}
