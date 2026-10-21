// Job queue scaffolding for out-of-band work (audio transcription, GCS
// archive, embeddings). BullMQ on top of Redis when REDIS_URL is set,
// otherwise runs the handler inline so local dev keeps working.
//
// This module is plumbing only. No production code path enqueues jobs
// here yet; that wiring lands in a follow-up after the worker process
// boots cleanly on Railway.

const REDIS_URL = process.env.REDIS_URL || "";
const QUEUE_NAME = process.env.WORKER_QUEUE_NAME || "medha-jobs";

const HANDLER_MODULES = {
  audio: "../../worker/handlers/audio.js",
  archive: "../../worker/handlers/archive.js",
  embedding: "../../worker/handlers/embedding.js",
};

let queueInstance = null;
let queueLoadError = null;
let warnedNoRedis = false;

async function getQueue() {
  if (!REDIS_URL) return null;
  if (queueInstance) return queueInstance;
  if (queueLoadError) return null;
  try {
    const { Queue } = await import("bullmq");
    queueInstance = new Queue(QUEUE_NAME, {
      connection: { url: REDIS_URL },
    });
    return queueInstance;
  } catch (err) {
    queueLoadError = err;
    console.warn(
      "[queue] bullmq import failed; falling back to inline execution:",
      err?.message || err,
    );
    return null;
  }
}

async function runInline(name, payload) {
  const modPath = HANDLER_MODULES[name];
  if (!modPath) {
    console.warn(`[queue] no inline handler registered for job "${name}"`);
    return null;
  }
  const mod = await import(modPath);
  const fn = mod.handle || mod.default;
  if (typeof fn !== "function") {
    console.warn(`[queue] handler module "${name}" exports no handle()`);
    return null;
  }
  return fn(payload);
}

export async function enqueue(name, payload, opts = {}) {
  const q = await getQueue();
  if (q) {
    return q.add(name, payload, opts);
  }
  if (!warnedNoRedis) {
    console.warn(
      "[queue] REDIS_URL unset; running jobs inline. Set REDIS_URL to enable BullMQ.",
    );
    warnedNoRedis = true;
  }
  return runInline(name, payload);
}

export const enqueueAudio = (payload, opts) => enqueue("audio", payload, opts);
export const enqueueArchive = (payload, opts) =>
  enqueue("archive", payload, opts);
export const enqueueEmbedding = (payload, opts) =>
  enqueue("embedding", payload, opts);

export const QUEUE_INTERNALS = { QUEUE_NAME, HANDLER_MODULES };
