/**
 * Pub/Sub subscriber wiring for the Togari worker harness.
 *
 * Started from `src/server.ts` when `TOGARI_WORKER_ENABLED=true`. Each
 * subscription pulls messages off its topic, decodes them as the matching
 * `WorkerMessage` variant, dispatches to the right `processX` handler, and
 * acks / nacks based on the handler's result.
 *
 * Failures inside a handler are caught here: we ack the message (so Pub/Sub
 * doesn't redeliver) only when the handler ended on a terminal state. For
 * unexpected exceptions we nack so the subscription's max-delivery-attempts
 * → DLQ flow can route it for human review.
 */

import { Message, PubSub, Subscription } from "@google-cloud/pubsub";
import { createLogger } from "../observability/logger";
import { captureSpanError, flushTracing } from "../lib/tracing";
import { processCompany } from "./jobs/processCompany";
import { processEnrichmentCompany } from "./jobs/processEnrichmentCompany";
import { SKIPPED_RETURN_VALUE } from "./processHelpers";
import {
  SUB_ENRICHMENT_WORKER,
  SUB_TIERING_WORKER,
  type EnrichmentCompanyMessage,
  type TieringCompanyMessage,
} from "./topics";

const logger = createLogger("worker/subscribers");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

let cachedPubSub: PubSub | null = null;
let activeSubscriptions: Subscription[] = [];

function pubsub(): PubSub {
  if (!cachedPubSub) {
    cachedPubSub = new PubSub({ projectId: PROJECT_ID });
  }
  return cachedPubSub;
}

function decode<T>(message: Message): T | null {
  try {
    return JSON.parse(message.data.toString("utf8")) as T;
  } catch (err) {
    logger.error("failed to decode pubsub message", err);
    return null;
  }
}

function attachHandler<T>(
  subscription: Subscription,
  handler: (msg: T) => Promise<unknown>,
  label: string,
): void {
  subscription.on("message", async (message: Message) => {
    const decoded = decode<T>(message);
    if (!decoded) {
      message.ack();
      return;
    }
    try {
      const result = await handler(decoded);
      if (result === SKIPPED_RETURN_VALUE) {
        logger.debug(`${label}: skipped (run not active)`);
      }
      message.ack();
    } catch (err) {
      logger.error(`${label}: handler threw`, err);
      captureSpanError(err);
      message.nack();
    }
  });

  subscription.on("error", (err) => {
    logger.error(`${label}: subscription error`, err);
    captureSpanError(err);
  });
}

export interface WorkerSubscriberOptions {
  /** Subscription names; defaults to the constants in topics.ts. */
  tieringSubscription?: string;
  enrichmentSubscription?: string;
  /** Per-subscriber flow-control message cap. Default 10. */
  maxMessages?: number;
}

export async function startWorkerSubscribers(
  opts: WorkerSubscriberOptions = {},
): Promise<void> {
  const tieringSubName = opts.tieringSubscription ?? SUB_TIERING_WORKER;
  const enrichmentSubName =
    opts.enrichmentSubscription ?? SUB_ENRICHMENT_WORKER;
  const maxMessages = opts.maxMessages ?? 10;

  const tiering = pubsub().subscription(tieringSubName, {
    flowControl: { maxMessages },
  });
  const enrichment = pubsub().subscription(enrichmentSubName, {
    flowControl: { maxMessages },
  });

  // Best-effort existence check; bail with a warning rather than crashing
  // the whole admin service if the topology hasn't been provisioned yet.
  for (const [sub, name] of [
    [tiering, tieringSubName] as const,
    [enrichment, enrichmentSubName] as const,
  ]) {
    try {
      const [exists] = await sub.exists();
      if (!exists) {
        logger.warn(
          `subscription ${name} does not exist — worker will idle (run the gcloud commands in worker/topics.ts).`,
        );
        continue;
      }
    } catch (err) {
      logger.warn(`subscription ${name} existence check failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
  }

  attachHandler<TieringCompanyMessage>(
    tiering,
    (msg) => processCompany(msg),
    "tiering-worker",
  );
  attachHandler<EnrichmentCompanyMessage>(
    enrichment,
    (msg) => processEnrichmentCompany(msg),
    "enrichment-worker",
  );

  activeSubscriptions = [tiering, enrichment];
  logger.info(
    `worker subscribers started: tiering=${tieringSubName}, enrichment=${enrichmentSubName}, maxMessages=${maxMessages}`,
  );
}

export async function stopWorkerSubscribers(): Promise<void> {
  for (const sub of activeSubscriptions) {
    try {
      await sub.close();
    } catch (err) {
      logger.warn("error closing subscription", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  activeSubscriptions = [];
  await flushTracing();
}
