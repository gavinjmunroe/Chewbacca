import { randomUUID } from "node:crypto";
import { BigQueryClient } from "../bigquery/client";
import { createLogger } from "../observability/logger";
import { ReplyPreflightError } from "./delivery";

const logger = createLogger("ReplySendClaim");
const project = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const table = `\`${project}.togari_data_lake.poller_leases\``;
// Guessed, not a measured latency bound. Uncertain sends retain this lease;
// their reply rows also remain held for provider-receipt reconciliation.
const LEASE_SECONDS = 5 * 60;

/** One pre-seeded warehouse row serializes manual and automated Zeutara sends. */
export async function withReplySendClaim<T>(
  clientId: string,
  work: () => Promise<T>,
): Promise<T> {
  const name = `reply-send:${clientId}`;
  const holder = randomUUID();
  let bq: BigQueryClient;
  try {
    bq = new BigQueryClient(
      project,
      null,
      process.env.GCP_CREDENTIALS_BASE64 ||
        process.env.GOOGLE_CREDENTIALS_BASE64 ||
        null,
    );
    const claim = await bq.executeWrite(
      `UPDATE ${table} SET holder = @holder,
       until = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL @seconds SECOND)
     WHERE name = @name AND (until IS NULL OR until < CURRENT_TIMESTAMP())
       AND (SELECT COUNT(*) FROM ${table} WHERE name = @name) = 1`,
      { name, holder, seconds: LEASE_SECONDS },
    );
    if (Number(claim.numDmlAffectedRows || 0) !== 1)
      throw new ReplyPreflightError(
        "Reply sender is busy or its unique send lease needs initialization",
      );
  } catch (error) {
    if (error instanceof ReplyPreflightError) throw error;
    throw new ReplyPreflightError(
      "Reply send claim is unavailable; no delivery was attempted",
    );
  }
  let release = false;
  try {
    const result = await work();
    release = true;
    return result;
  } catch (error) {
    release = error instanceof ReplyPreflightError;
    throw error;
  } finally {
    if (release) {
      await bq
        .executeWrite(
          `UPDATE ${table} SET holder = '', until = CURRENT_TIMESTAMP()
         WHERE name = @name AND holder = @holder`,
          { name, holder },
        )
        .catch((error) => {
          logger.warn("reply_send.release_failed", { error: String(error) });
        });
    }
  }
}
