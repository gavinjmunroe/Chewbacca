/**
 * Apple-specific Fastify routes:
 *
 *   POST /dnc/auth/apple/credentials
 *     Auth: Privy JWT (this is dashboard-only)
 *     Body: { username, password }   // iCloud email + app-specific password
 *     Action: verify creds work, persist to Secret Manager, start the poller.
 *
 *   DELETE /dnc/auth/apple/credentials
 *     Auth: Privy JWT
 *     Action: stop poller, delete credentials.
 *
 *   POST /api/v1/people/:contact_id/push-to-apple
 *     Auth: tgi_live_ API key (Clay-callable)
 *     Action: serialize the contact to a vCard, PUT to iCloud, persist the
 *             apple_contact_id + apple_etag on the contact row.
 *
 * Privy DID is the only tenant identifier — pulled from `request.privyUser.userId`
 * on JWT routes and `request.apiKey.ownerDid` on bearer routes.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { BigQuery } from "@google-cloud/bigquery";
import { randomUUID } from "crypto";
import { validateSessionToken } from "../auth/auth-bridge.ts";
import { validateApiKey } from "../auth/api-key-middleware.ts";
import {
  saveAppleCredentials,
  getAppleCredentials,
  deleteAppleCredentials,
} from "../auth/apple-credentials.ts";
import {
  verifyCredentials,
  newContactHref,
  putContact,
} from "../integrations/carddav.ts";
import { serializeVCard } from "../integrations/vcard.ts";
import { startApplePoller, stopApplePoller } from "../workers/apple-sync.ts";
import type { UnifiedContact } from "../types/index.ts";

const PROJECT_ID = process.env.GCP_PROJECT_ID ?? "midyear-glazing-485303-u3";
const DATASET = "togari_dnc";
const CONTACTS_TABLE = "contacts";

let _bq: BigQuery | null = null;
function bq(): BigQuery {
  if (_bq) return _bq;
  const opts: ConstructorParameters<typeof BigQuery>[0] = {
    projectId: PROJECT_ID,
  };
  const b64 = process.env.GCP_CREDENTIALS_BASE64;
  if (b64) opts.credentials = JSON.parse(Buffer.from(b64, "base64").toString());
  _bq = new BigQuery(opts);
  return _bq;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadContact(
  contactId: string,
  ownerDid: string,
): Promise<UnifiedContact | null> {
  const [rows] = await bq().query({
    query: `
      SELECT *
      FROM \`${PROJECT_ID}.${DATASET}.${CONTACTS_TABLE}\`
      WHERE contact_id = @contact_id AND owner_did = @owner_did
      LIMIT 1
    `,
    params: { contact_id: contactId, owner_did: ownerDid },
    types: { contact_id: "STRING", owner_did: "STRING" },
    useLegacySql: false,
  });
  if (!rows || rows.length === 0) return null;
  return rows[0] as UnifiedContact;
}

async function persistAppleIds(
  contactId: string,
  ownerDid: string,
  appleContactId: string,
  appleEtag: string,
): Promise<void> {
  await bq().query({
    query: `
      UPDATE \`${PROJECT_ID}.${DATASET}.${CONTACTS_TABLE}\`
      SET apple_contact_id = @apple_contact_id,
          apple_etag = @apple_etag,
          last_updated_at = CURRENT_TIMESTAMP()
      WHERE contact_id = @contact_id AND owner_did = @owner_did
    `,
    params: {
      apple_contact_id: appleContactId,
      apple_etag: appleEtag,
      contact_id: contactId,
      owner_did: ownerDid,
    },
    types: {
      apple_contact_id: "STRING",
      apple_etag: "STRING",
      contact_id: "STRING",
      owner_did: "STRING",
    },
    useLegacySql: false,
  });
}

// ─── Route handlers ──────────────────────────────────────────────────────────

interface CredentialsBody {
  username?: string;
  password?: string;
}

async function handleStoreCredentials(
  request: FastifyRequest<{ Body: CredentialsBody }>,
  reply: FastifyReply,
): Promise<void> {
  const ownerDid = request.privyUser?.userId;
  if (!ownerDid) {
    await reply.status(401).send({ error: "Unauthenticated" });
    return;
  }

  const { username, password } = request.body ?? {};

  if (!username || !password) {
    await reply.status(400).send({
      error:
        "Both 'username' (iCloud email) and 'password' (app-specific) are required",
    });
    return;
  }

  let addressBookHref: string | null = null;
  try {
    const { addressBook } = await verifyCredentials({ username, password });
    addressBookHref = addressBook.href;
  } catch (err) {
    await reply.status(400).send({
      error: "iCloud credentials did not validate",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    await saveAppleCredentials({
      ownerDid,
      username,
      password,
      connected_at: new Date().toISOString(),
      default_addressbook_href: addressBookHref,
    });
  } catch (err) {
    await reply.status(500).send({
      error: "Failed to persist credentials",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  startApplePoller(ownerDid).catch((err: unknown) => {
    process.stderr.write(
      `[Apple] poller start failed for ${ownerDid}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });

  await reply
    .status(200)
    .send({ connected: true, addressbook: addressBookHref });
}

async function handleDeleteCredentials(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const ownerDid = request.privyUser?.userId;
  if (!ownerDid) {
    await reply.status(401).send({ error: "Unauthenticated" });
    return;
  }
  stopApplePoller(ownerDid);
  try {
    await deleteAppleCredentials(ownerDid);
  } catch (err) {
    await reply.status(500).send({
      error: "Failed to delete credentials",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  await reply.status(200).send({ connected: false });
}

async function handlePushToApple(
  request: FastifyRequest<{ Params: { contact_id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const ctx = request.apiKey;
  if (!ctx) {
    await reply.status(401).send({ error: "Missing API key context" });
    return;
  }

  const contactId = request.params.contact_id;
  if (!contactId) {
    await reply.status(400).send({ error: "Missing :contact_id in path" });
    return;
  }

  const creds = await getAppleCredentials(ctx.ownerDid);
  if (!creds) {
    await reply.status(412).send({
      error: "Apple not connected",
      message: "Connect Apple via the dashboard before pushing contacts",
    });
    return;
  }

  let contact: UnifiedContact | null;
  try {
    contact = await loadContact(contactId, ctx.ownerDid);
  } catch (err) {
    await reply.status(500).send({
      error: "BQ lookup failed",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (!contact) {
    await reply
      .status(404)
      .send({ error: `Contact ${contactId} not found for this owner` });
    return;
  }

  const isUpdate = Boolean(contact.apple_contact_id);
  const uid = contact.apple_contact_id ?? `medha-${randomUUID()}`;

  const addressBookHref = creds.default_addressbook_href;
  if (!addressBookHref) {
    await reply.status(500).send({
      error:
        "No default addressbook on file — reconnect Apple from the dashboard",
    });
    return;
  }

  const href = newContactHref(addressBookHref, uid);
  const vcardBody = serializeVCard(contact, { uid });

  let result: { href: string; etag: string };
  try {
    result = await putContact(
      { username: creds.username, password: creds.password },
      href,
      vcardBody,
      isUpdate && contact.apple_etag
        ? { ifMatch: contact.apple_etag }
        : { ifNoneMatch: true },
    );
  } catch (err) {
    await reply.status(502).send({
      error: "iCloud PUT failed",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    await persistAppleIds(contactId, ctx.ownerDid, uid, result.etag);
  } catch (err) {
    process.stderr.write(
      `[Apple] push succeeded but failed to persist apple_contact_id for ${contactId}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  await reply.status(200).send({
    pushed: true,
    apple_contact_id: uid,
    apple_etag: result.etag,
    href: result.href,
    action: isUpdate ? "update" : "create",
  });
}

// ─── Registration ────────────────────────────────────────────────────────────

export async function registerAppleRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.post<{ Body: CredentialsBody }>(
    "/dnc/auth/apple/credentials",
    { preHandler: validateSessionToken },
    handleStoreCredentials,
  );

  fastify.delete(
    "/dnc/auth/apple/credentials",
    { preHandler: validateSessionToken },
    handleDeleteCredentials,
  );

  fastify.post<{ Params: { contact_id: string } }>(
    "/api/v1/people/:contact_id/push-to-apple",
    { preHandler: validateApiKey },
    handlePushToApple,
  );

  fastify.log.info(
    "[Dedup v2] apple routes registered: POST/DELETE /dnc/auth/apple/credentials, POST /api/v1/people/:contact_id/push-to-apple",
  );
}
