/**
 * A small concurrency-limited, retrying work queue for the ENRICH function
 * (spec §2, item 172).
 *
 * Background enrichment (a sweep over many contacts, or a NOTIFY refresh batch)
 * must not fire dozens of simultaneous Perplexity Search + Agent calls inline.
 * That thrashes the upstream rate limits and can stall the event loop with
 * unbounded in-flight promises. This queue bounds the in-flight count and adds a
 * bounded, jittered exponential backoff so a transient upstream blip is retried
 * instead of dropped.
 *
 * It is deliberately tiny and dependency-free: a task is just a thunk returning
 * a promise. `sleep` is injectable so tests run instantly with no real timers.
 *
 *   const q = createEnrichmentQueue({ concurrency: 3, maxRetries: 2 });
 *   const result = await q.add(() => enrichPerson(did, contact, opts));
 *   await q.onIdle();
 *
 * Each task resolves/rejects independently; one task throwing never tears down
 * the queue. `shouldRetry(err)` lets the caller skip retrying non-transient
 * failures (e.g. a 404). Never throws on construction.
 */

const DEFAULTS = {
  concurrency: 3,
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 5000,
};

/** Default sleep, a real timer. Injectable for tests. */
function realSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deterministic-ish jitter in [0.5, 1.0] derived from the attempt number, so
 * retries spread out without needing Math.random (which is banned in some
 * runtimes and makes tests non-deterministic).
 */
function jitterFactor(attempt) {
  return 0.5 + ((attempt * 0.13) % 0.5);
}

export function createEnrichmentQueue(opts = {}) {
  const concurrency = Math.max(
    1,
    Number(opts.concurrency) || DEFAULTS.concurrency,
  );
  const maxRetries = Number.isFinite(Number(opts.maxRetries))
    ? Math.max(0, Number(opts.maxRetries))
    : DEFAULTS.maxRetries;
  const baseDelayMs = Math.max(
    0,
    Number(opts.baseDelayMs) || DEFAULTS.baseDelayMs,
  );
  const maxDelayMs = Math.max(
    baseDelayMs,
    Number(opts.maxDelayMs) || DEFAULTS.maxDelayMs,
  );
  const sleep = typeof opts.sleep === "function" ? opts.sleep : realSleep;
  const shouldRetry =
    typeof opts.shouldRetry === "function" ? opts.shouldRetry : () => true;

  const queue = [];
  let active = 0;
  const idleWaiters = [];

  function settleIdle() {
    if (active === 0 && queue.length === 0) {
      while (idleWaiters.length) idleWaiters.shift()();
    }
  }

  function pump() {
    while (active < concurrency && queue.length > 0) {
      const job = queue.shift();
      active++;
      runJob(job).finally(() => {
        active--;
        // Drain the next job, then check whether the whole queue is idle.
        pump();
        settleIdle();
      });
    }
  }

  async function runJob(job) {
    let attempt = 0;
    for (;;) {
      try {
        const value = await job.task();
        job.resolve(value);
        return;
      } catch (err) {
        if (attempt >= maxRetries || !shouldRetry(err)) {
          job.reject(err);
          return;
        }
        const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        await sleep(Math.round(backoff * jitterFactor(attempt)));
        attempt++;
      }
    }
  }

  return {
    /** Enqueue a task thunk; resolves/rejects with the task's outcome. */
    add(task) {
      if (typeof task !== "function") {
        return Promise.reject(new TypeError("task must be a function"));
      }
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        pump();
      });
    },
    /** Enqueue many tasks; resolves to a settled-results array (never throws). */
    addAll(tasks) {
      const list = Array.isArray(tasks) ? tasks : [];
      return Promise.all(
        list.map((t) =>
          this.add(t).then(
            (value) => ({ status: "fulfilled", value }),
            (reason) => ({ status: "rejected", reason }),
          ),
        ),
      );
    },
    /** Resolves once the queue has fully drained (no active + no pending). */
    onIdle() {
      if (active === 0 && queue.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
    get size() {
      return queue.length;
    },
    get pending() {
      return active;
    },
  };
}
