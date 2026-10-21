// medha-worker entry point.
//
// Boots a BullMQ Worker that listens on the shared Redis queue and
// dispatches jobs to the handlers in ./handlers/. This is a separate
// process from amber-agent; both services share REDIS_URL.
//
// If REDIS_URL is unset, exits cleanly so local dev does not crash.

import * as audio from "./handlers/audio.js";
import * as archive from "./handlers/archive.js";
import * as embedding from "./handlers/embedding.js";

const REDIS_URL = process.env.REDIS_URL || "";
const QUEUE_NAME = process.env.WORKER_QUEUE_NAME || "medha-jobs";
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || "4");

const HANDLERS = {
  audio: audio.handle,
  archive: archive.handle,
  embedding: embedding.handle,
};

async function main() {
  if (!REDIS_URL) {
    console.warn("[worker] REDIS_URL not set; nothing to do. Exiting cleanly.");
    return;
  }

  let Worker;
  try {
    ({ Worker } = await import("bullmq"));
  } catch (err) {
    console.error(
      "[worker] failed to import bullmq; check that the package is installed:",
      err?.message || err,
    );
    process.exit(1);
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const fn = HANDLERS[job.name];
      if (!fn) {
        throw new Error(`no handler registered for job "${job.name}"`);
      }
      return fn(job.data);
    },
    {
      connection: { url: REDIS_URL },
      concurrency: CONCURRENCY,
    },
  );

  worker.on("ready", () =>
    console.log(
      `[worker] listening on queue "${QUEUE_NAME}" (concurrency=${CONCURRENCY})`,
    ),
  );
  worker.on("completed", (job) =>
    console.log(`[worker] job ${job.id} (${job.name}) completed`),
  );
  worker.on("failed", (job, err) =>
    console.error(
      `[worker] job ${job?.id} (${job?.name}) failed:`,
      err?.message || err,
    ),
  );
  worker.on("error", (err) =>
    console.error("[worker] error:", err?.message || err),
  );

  const shutdown = async (sig) => {
    console.log(`[worker] ${sig} received, shutting down...`);
    try {
      await worker.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] fatal:", err?.message || err);
  process.exit(1);
});
