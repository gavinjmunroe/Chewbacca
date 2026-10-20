/**
 * Pub/Sub topology for the Togari worker harness.
 *
 * Each topic carries one message per company (or per work unit). Subscribers
 * ack each message individually so concurrency is governed by the
 * subscription flow-control + the number of running container replicas, not
 * by a Postgres polling loop the way autotier's scheduler did.
 *
 * Provisioning (run once per environment, idempotent):
 *
 *   PROJECT=midyear-glazing-485303-u3
 *
 *   gcloud pubsub topics create togari.tiering.company --project=$PROJECT
 *   gcloud pubsub topics create togari.enrichment.company --project=$PROJECT
 *
 *   gcloud pubsub subscriptions create togari-tiering-worker-sub \
 *     --topic=togari.tiering.company \
 *     --ack-deadline=600 \
 *     --message-retention-duration=24h \
 *     --max-delivery-attempts=5 \
 *     --dead-letter-topic=togari.dlq \
 *     --project=$PROJECT
 *
 *   gcloud pubsub subscriptions create togari-enrichment-worker-sub \
 *     --topic=togari.enrichment.company \
 *     --ack-deadline=600 \
 *     --message-retention-duration=24h \
 *     --max-delivery-attempts=5 \
 *     --dead-letter-topic=togari.dlq \
 *     --project=$PROJECT
 *
 *   # DLQ for inspection / replay
 *   gcloud pubsub topics create togari.dlq --project=$PROJECT
 *   gcloud pubsub subscriptions create togari-dlq-sub --topic=togari.dlq --project=$PROJECT
 *
 * Ack deadline of 10 min covers the longest agent enrichment job; if a step
 * runs hot the subscriber explicitly extends the deadline via `modifyAckDeadline`.
 */

export const TOPIC_TIERING_COMPANY = "togari.tiering.company";
export const TOPIC_ENRICHMENT_COMPANY = "togari.enrichment.company";
export const TOPIC_DLQ = "togari.dlq";

export const SUB_TIERING_WORKER = "togari-tiering-worker-sub";
export const SUB_ENRICHMENT_WORKER = "togari-enrichment-worker-sub";

/**
 * Wire-format payloads. Keep these stable — they're the contract between the
 * scheduler (publisher) and the subscribers (workers).
 *
 * Versioned via the top-level `v` field so we can evolve safely.
 */

export interface TieringCompanyMessage {
  v: 1;
  tenantId: string;
  runId: string;
  companyId: string;
  /** Optional priority hint propagated from `tiering_runs.priority`. */
  priority?: number;
  /** Optional message attempt number; mostly informational. */
  attempt?: number;
}

export interface EnrichmentCompanyMessage {
  v: 1;
  tenantId: string;
  runId: string;
  companyId: string;
  mode: "sequential" | "agent";
  attempt?: number;
}

export type WorkerMessage =
  | TieringCompanyMessage
  | EnrichmentCompanyMessage;
