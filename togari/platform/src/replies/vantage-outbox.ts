import { createHash } from "node:crypto";
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { createLogger } from "../observability/logger";
import { vantageEnabled, vantageLogSent, type VantageSent } from "./vantage";
import type { ThreadMessage } from "../integrations/clay/campaign-read";

const logger = createLogger("VantageOutbox");
const tables = new Map<string, Promise<void>>();

function storage() {
  const project = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
  return {
    table: `\`${project}.${resolveDataset()}.vantage_sent_outbox\``,
    bq: new BigQueryClient(
      project,
      null,
      process.env.GCP_CREDENTIALS_BASE64 ||
        process.env.GOOGLE_CREDENTIALS_BASE64 ||
        null,
    ),
  };
}

async function ensureTable() {
  const db = storage();
  if (!tables.has(db.table)) {
    const pending = (async () => {
      const table = db.bq
        .getClient()
        .dataset(resolveDataset())
        .table("vantage_sent_outbox");
      const [exists] = await table.exists();
      if (!exists) {
        try {
          await table.create({
            schema: [
              { name: "id", type: "STRING", mode: "REQUIRED" },
              { name: "client_id", type: "STRING", mode: "REQUIRED" },
              { name: "payload", type: "STRING", mode: "REQUIRED" },
              { name: "status", type: "STRING", mode: "REQUIRED" },
              { name: "updated_at", type: "TIMESTAMP", mode: "REQUIRED" },
              { name: "created_at", type: "TIMESTAMP", mode: "REQUIRED" },
              { name: "delivered_at", type: "TIMESTAMP" },
            ],
          });
        } catch (error) {
          if ((error as { code?: number }).code !== 409) throw error;
        }
      }
    })();
    tables.set(db.table, pending);
    pending.catch(() => tables.delete(db.table));
  }
  await tables.get(db.table);
  return db;
}

async function deliver(id: string, clientId: string): Promise<void> {
  const { bq, table } = storage();
  // A lease prevents overlapping pollers and send callbacks from logging the
  // same receipt concurrently. A crash after HTTP success can still retry it.
  const claim = await bq.executeWrite(
    `UPDATE ${table} SET status = 'sending', updated_at = CURRENT_TIMESTAMP()
     WHERE id = @id AND client_id = @clientId AND
       (status = 'pending' OR (status = 'sending' AND
        updated_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE)))`,
    { id, clientId },
  );
  if (Number(claim.numDmlAffectedRows || 0) === 0) return;
  const { rows } = await bq.executeQuery(
    `SELECT payload FROM ${table} WHERE id = @id AND client_id = @clientId LIMIT 1`,
    { id, clientId },
  );
  if (!rows[0]) throw new Error("Claimed Vantage receipt is missing");
  const payload = JSON.parse(String(rows[0].payload)) as VantageSent;
  // Vantage answers 400 to a receipt with no text, so it can never succeed.
  // Akbar's blank 2026-10-16 email retried every five minutes all day.
  if (!String(payload.text || "").trim()) {
    await bq.executeWrite(
      `UPDATE ${table} SET status = 'dead_letter', updated_at = CURRENT_TIMESTAMP()
       WHERE id = @id AND client_id = @clientId AND status = 'sending'`,
      { id, clientId },
    );
    logger.warn("vantage_receipt.dead_letter", {
      clientId,
      reason: "empty provider body",
    });
    return;
  }
  try {
    await vantageLogSent(payload);
    await bq.executeWrite(
      `UPDATE ${table} SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP(),
         updated_at = CURRENT_TIMESTAMP() WHERE id = @id AND client_id = @clientId`,
      { id, clientId },
    );
  } catch (error) {
    await bq.executeWrite(
      `UPDATE ${table} SET status = 'pending', updated_at = CURRENT_TIMESTAMP()
       WHERE id = @id AND client_id = @clientId AND status = 'sending'`,
      { id, clientId },
    );
    throw error;
  }
}

/** Persist a provider-confirmed send before trying Vantage. Never sends email. */
export async function retainVantageReceipt(
  clientId: string,
  to: string,
  sent: ThreadMessage,
): Promise<void> {
  if (!vantageEnabled(clientId)) return;
  if (
    sent.type !== "SENT" ||
    !sent.messageId ||
    !sent.from ||
    !Number.isFinite(Date.parse(sent.time))
  )
    throw new Error(
      "Vantage logging requires a complete provider send receipt",
    );
  const payload: VantageSent = {
    to_email: to,
    from_email: sent.from,
    subject: sent.subject,
    text: sent.body,
    sent_at: sent.time,
  };
  const id = createHash("sha256")
    .update(JSON.stringify([clientId, to.toLowerCase(), sent.messageId]))
    .digest("hex");
  const { bq, table } = await ensureTable();
  await bq.executeWrite(
    `MERGE ${table} T USING (SELECT @id AS id, @clientId AS client_id) S
     ON T.id = S.id AND T.client_id = S.client_id
     WHEN NOT MATCHED THEN INSERT (id, client_id, payload, status, updated_at, created_at)
     VALUES (@id, @clientId, @payload, 'pending', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
    { id, clientId, payload: JSON.stringify(payload) },
  );
  await deliver(id, clientId);
}

/** Independent of reply-row state and newer inbound messages. */
export async function flushVantageReceipts(clientId: string): Promise<void> {
  if (!vantageEnabled(clientId)) return;
  const { bq, table } = await ensureTable();
  const { rows } = await bq.executeQuery(
    `SELECT id FROM ${table} WHERE client_id = @clientId AND
       (status = 'pending' OR (status = 'sending' AND
        updated_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE)))
     ORDER BY updated_at LIMIT 20`,
    { clientId },
  );
  for (const row of rows) {
    try {
      await deliver(String(row.id), clientId);
    } catch (error) {
      logger.warn("vantage_receipt.retry_failed", { error: String(error) });
    }
  }
}
