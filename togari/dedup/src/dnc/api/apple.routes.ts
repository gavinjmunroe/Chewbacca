/**
 * Apple-specific routes:
 *
 *   POST /dnc/auth/apple/credentials
 *     Auth: Auth0 JWT (this is dashboard-only)
 *     Body: { username, password }   // iCloud email + app-specific password
 *     Action: verify creds work, persist to Secret Manager, start the poller.
 *
 *   DELETE /dnc/auth/apple/credentials
 *     Auth: Auth0 JWT
 *     Action: stop poller, delete credentials.
 *
 *   POST /api/v1/people/:contact_id/push-to-apple
 *     Auth: tgi_live_ API key (Clay-callable)
 *     Action: serialize the contact to a vCard, PUT to iCloud, persist the
 *             apple_contact_id + apple_etag on the contact row.
 */

import type { Application, Request, Response } from "express";
import { BigQuery } from "@google-cloud/bigquery";
import { randomUUID } from "crypto";
import { requireJwt } from "../../middleware/auth.js";
import { validateApiKey } from "../auth/api-key-middleware.js";
import {
  saveAppleCredentials,
  getAppleCredentials,
  deleteAppleCredentials,
} from "../auth/apple-credentials.js";
import {
  verifyCredentials,
  newContactHref,
  putContact,
} from "../integrations/carddav.js";
import { serializeVCard } from "../integrations/vcard.js";
import { startApplePoller, stopApplePoller } from "../workers/apple-sync.js";
import type { ApiKeyContext, UnifiedContact } from "../types/index.js";

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
  ownerId: string,
): Promise<UnifiedContact | null> {
  const [rows] = await bq().query({
    query: `
      SELECT *
      FROM \`${PROJECT_ID}.${DATASET}.${CONTACTS_TABLE}\`
      WHERE contact_id = @contact_id AND owner_id = @owner_id
      LIMIT 1
    `,
    params: { contact_id: contactId, owner_id: ownerId },
    types: { contact_id: "STRING", owner_id: "STRING" },
    useLegacySql: false,
  });
  if (!rows || rows.length === 0) return null;
  return rows[0] as UnifiedContact;
}

async function persistAppleIds(
  contactId: string,
  ownerId: string,
  appleContactId: string,
  appleEtag: string,
): Promise<void> {
  await bq().query({
    query: `
      UPDATE \`${PROJECT_ID}.${DATASET}.${CONTACTS_TABLE}\`
      SET apple_contact_id = @apple_contact_id,
          apple_etag = @apple_etag,
          last_updated_at = CURRENT_TIMESTAMP()
      WHERE contact_id = @contact_id AND owner_id = @owner_id
    `,
    params: {
      apple_contact_id: appleContactId,
      apple_etag: appleEtag,
      contact_id: contactId,
      owner_id: ownerId,
    },
    types: {
      apple_contact_id: "STRING",
      apple_etag: "STRING",
      contact_id: "STRING",
      owner_id: "STRING",
    },
    useLegacySql: false,
  });
}

// ─── Route handlers ──────────────────────────────────────────────────────────

async function handleStoreCredentials(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  const { username, password } = (req.body ?? {}) as {
    username?: string;
    password?: string;
  };

  if (!username || !password) {
    res.status(400).json({
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
    res.status(400).json({
      error: "iCloud credentials did not validate",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    await saveAppleCredentials({
      userId,
      username,
      password,
      connected_at: new Date().toISOString(),
      default_addressbook_href: addressBookHref,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to persist credentials",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  startApplePoller(userId).catch((err: unknown) => {
    process.stderr.write(
      `[Apple] poller start failed for ${userId}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });

  res.status(200).json({ connected: true, addressbook: addressBookHref });
}

async function handleDeleteCredentials(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  stopApplePoller(userId);
  try {
    await deleteAppleCredentials(userId);
  } catch (err) {
    res.status(500).json({
      error: "Failed to delete credentials",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  res.status(200).json({ connected: false });
}

async function handlePushToApple(req: Request, res: Response): Promise<void> {
  const ctx = res.locals.apiKey as ApiKeyContext | undefined;
  if (!ctx) {
    res.status(401).json({ error: "Missing API key context" });
    return;
  }

  const contactIdParam = req.params.contact_id;
  const contactId = Array.isArray(contactIdParam)
    ? contactIdParam[0]
    : contactIdParam;
  if (!contactId) {
    res.status(400).json({ error: "Missing :contact_id in path" });
    return;
  }

  const creds = await getAppleCredentials(ctx.ownerId);
  if (!creds) {
    res.status(412).json({
      error: "Apple not connected",
      message: "Connect Apple via the dashboard before pushing contacts",
    });
    return;
  }

  let contact: UnifiedContact | null;
  try {
    contact = await loadContact(contactId, ctx.ownerId);
  } catch (err) {
    res.status(500).json({
      error: "BQ lookup failed",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (!contact) {
    res
      .status(404)
      .json({ error: `Contact ${contactId} not found for this owner` });
    return;
  }

  const isUpdate = Boolean(contact.apple_contact_id);
  const uid = contact.apple_contact_id ?? `togari-${randomUUID()}`;

  const addressBookHref = creds.default_addressbook_href;
  if (!addressBookHref) {
    res.status(500).json({
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
    res.status(502).json({
      error: "iCloud PUT failed",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    await persistAppleIds(contactId, ctx.ownerId, uid, result.etag);
  } catch (err) {
    process.stderr.write(
      `[Apple] push succeeded but failed to persist apple_contact_id for ${contactId}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  res.status(200).json({
    pushed: true,
    apple_contact_id: uid,
    apple_etag: result.etag,
    href: result.href,
    action: isUpdate ? "update" : "create",
  });
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerAppleRoutes(app: Application): void {
  app.post("/dnc/auth/apple/credentials", requireJwt, (req, res) => {
    handleStoreCredentials(req, res).catch((err: unknown) => {
      process.stderr.write(
        `[Apple] credentials handler error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      if (!res.headersSent) res.status(500).json({ error: "Internal error" });
    });
  });

  app.delete("/dnc/auth/apple/credentials", requireJwt, (req, res) => {
    handleDeleteCredentials(req, res).catch((err: unknown) => {
      process.stderr.write(
        `[Apple] delete-credentials handler error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      if (!res.headersSent) res.status(500).json({ error: "Internal error" });
    });
  });

  app.post(
    "/api/v1/people/:contact_id/push-to-apple",
    validateApiKey,
    (req, res) => {
      handlePushToApple(req, res).catch((err: unknown) => {
        process.stderr.write(
          `[Apple] push handler error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        if (!res.headersSent) res.status(500).json({ error: "Internal error" });
      });
    },
  );

  console.log(
    "[Dedup v2] apple routes registered: POST/DELETE /dnc/auth/apple/credentials, POST /api/v1/people/:contact_id/push-to-apple",
  );
}
