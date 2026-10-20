/**
 * Deck library: one deck link per client company, so a "send me the deck"
 * reply is answered from the card in one press.
 *
 * Caleb, 2026-10-09: three investors asked for decks in Zeutara's first week
 * (Crosslink for Goldie's, Six Trees and Infinity for Qube) and each one
 * waited on Jonah finding the deck and sending it by hand. The card said
 * "I sent the deck" and nothing more. Now the first time a company's deck is
 * needed Jonah pastes its link once; every later deck request opens with it
 * already filled in.
 *
 * Two ways in: paste a DocSend / Drive / Pitch link, or upload the PDF in the
 * modal. An upload stays in Slack (the bot gained files:read on 2026-10-09)
 * and is served from Togari's own address, /d/<token>, so the investor gets a
 * plain link that works without a Slack account. No bucket: the service
 * account has no Cloud Storage rights, and Slack already holds the file.
 */
import { BigQueryClient } from "../bigquery/client";
import crypto from "node:crypto";
import { resolveDataset } from "../services/dataset-resolver";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

export function decksTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.client_decks\``;
}

function bq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

/** Company key: case and spacing never make two decks for one company. */
export function companyKey(company: string): string {
  return company.trim().toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ");
}

/** An http(s) URL, or null. Anything else would land in an investor's inbox as text. */
export function cleanDeckUrl(raw: string | null | undefined): string | null {
  const s = (raw || "").trim();
  if (!/^https?:\/\/\S+$/i.test(s)) return null;
  try {
    return new URL(s).toString();
  } catch {
    return null;
  }
}

export async function getDeck(
  clientId: string,
  company: string,
): Promise<string | null> {
  const { rows } = (await bq().executeQuery(
    `SELECT url FROM ${decksTable()}
      WHERE client_id = @clientId AND company_key = @key
      ORDER BY added_at DESC LIMIT 1`,
    { clientId, key: companyKey(company) },
  )) as unknown as { rows: Array<{ url: string }> };
  return rows?.[0]?.url ?? null;
}

export async function saveDeck(
  clientId: string,
  company: string,
  url: string,
  addedBy: string,
): Promise<void> {
  await bq().executeWrite(
    `INSERT INTO ${decksTable()} (client_id, company, company_key, url, added_by, added_at)
     VALUES (@clientId, @company, @key, @url, @addedBy, CURRENT_TIMESTAMP())`,
    { clientId, company, key: companyKey(company), url, addedBy },
  );
}

/** The reply that carries the deck. Short: the link is the message. */
export function deckReplyBody(
  leadName: string | null | undefined,
  company: string,
  url: string,
  signoff: string,
): string {
  const first = (leadName || "").trim().split(/\s+/)[0];
  const hi = first ? `Hi ${first},` : "Hi,";
  return `${hi}\n\nHere's the ${company} deck: ${url}\n\nHappy to set up a short call if it looks like a fit.\n\n${signoff}`;
}

/** Public base for deck links. */
function publicBase(): string {
  return (
    process.env.TOGARI_PUBLIC_BASE_URL ||
    "https://togari-bma-prod.up.railway.app"
  ).replace(/\/+$/, "");
}

/**
 * Save an uploaded deck: the Slack file stays where it is, and a random token
 * becomes the link an investor opens. Returns that link.
 */
export async function saveDeckFile(
  clientId: string,
  company: string,
  slackFileId: string,
  fileName: string,
  addedBy: string,
): Promise<string> {
  const token = crypto.randomBytes(16).toString("hex");
  const url = `${publicBase()}/d/${token}`;
  await bq().executeWrite(
    `INSERT INTO ${decksTable()} (client_id, company, company_key, url, added_by, added_at, token, slack_file_id, file_name)
     VALUES (@clientId, @company, @key, @url, @addedBy, CURRENT_TIMESTAMP(), @token, @fileId, @fileName)`,
    {
      clientId,
      company,
      key: companyKey(company),
      url,
      addedBy,
      token,
      fileId: slackFileId,
      fileName,
    },
  );
  return url;
}

/**
 * A deck stored in Togari's own table, keyed by the /d/ token an investor
 * already holds. Every Slack-hosted deck went file_not_found and four
 * investors got 404s (2026-10-13); the same PDFs Jonah gave us were loaded
 * into deck_files under their old tokens, so the links in those inboxes open
 * again. Cached in memory: three decks are 34MB and never change.
 */
const storedDeckCache = new Map<
  string,
  { fileName: string; mime: string; content: Buffer } | null
>();

export async function storedDeckByToken(
  token: string,
): Promise<{ fileName: string; mime: string; content: Buffer } | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  if (storedDeckCache.has(token)) return storedDeckCache.get(token) ?? null;
  const table = `\`${PROJECT_ID}.${resolveDataset()}.deck_files\``;
  // BigQuery returns at most 20MB per row and the Qube deck alone is 19MB raw
  // (25MB on the wire), so each file is stored in 6MB parts.
  const { rows } = (await bq().executeQuery(
    `SELECT file_name, mime, part, content FROM ${table} WHERE token = @token ORDER BY part`,
    { token },
  )) as unknown as {
    rows: Array<{
      file_name: string;
      mime: string;
      part: number;
      content: unknown;
    }>;
  };
  const toBuf = (raw: unknown): Buffer | null =>
    Buffer.isBuffer(raw)
      ? raw
      : typeof raw === "string"
        ? Buffer.from(raw, "base64")
        : raw instanceof Uint8Array
          ? Buffer.from(raw)
          : null;
  const parts = (rows || []).map((x) => toBuf(x.content));
  const r = rows?.[0];
  const hit =
    r && parts.length && parts.every(Boolean)
      ? {
          fileName: r.file_name,
          mime: r.mime,
          content: Buffer.concat(parts as Buffer[]),
        }
      : null;
  if (hit) storedDeckCache.set(token, hit);
  return hit;
}

/** Load every stored deck into memory. Returns how many loaded. */
export async function warmStoredDecks(): Promise<number> {
  const table = `\`${PROJECT_ID}.${resolveDataset()}.deck_files\``;
  const { rows } = (await bq().executeQuery(
    `SELECT DISTINCT token FROM ${table}`,
    {},
  )) as unknown as { rows: Array<{ token: string }> };
  let n = 0;
  for (const r of rows || []) if (await storedDeckByToken(r.token)) n++;
  return n;
}

/** The Slack file behind a deck link, or null for an unknown token. */
export async function deckFileByToken(
  token: string,
): Promise<{ slackFileId: string; fileName: string; clientId: string } | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const { rows } = (await bq().executeQuery(
    `SELECT slack_file_id, file_name, client_id FROM ${decksTable()}
      WHERE token = @token AND slack_file_id IS NOT NULL LIMIT 1`,
    { token },
  )) as unknown as {
    rows: Array<{
      slack_file_id: string;
      file_name: string;
      client_id: string;
    }>;
  };
  const r = rows?.[0];
  return r
    ? {
        slackFileId: r.slack_file_id,
        fileName: r.file_name,
        clientId: r.client_id,
      }
    : null;
}
