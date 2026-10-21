/**
 * bq-dlq.js — Dead-letter queue for failed BigQuery writes.
 *
 * Flaw #37: when insertRow / mergeRow fails (network blip, schema mismatch,
 * quota), we previously dropped the row on the floor with a warn. Now we
 * append the failed write to a JSONL file so a background replayer can
 * retry it later.
 *
 * Storage: /tmp/medha-pdw-dlq.jsonl
 *
 * Format (one JSON object per line):
 *   { table, row, attempts, last_error, at }
 *
 * Persistence caveat: Railway resets /tmp on every redeploy. That's
 * acceptable for v1 — the DLQ survives crashes and transient errors,
 * which is the 99% case. Production-grade durability would move this
 * to Firestore or a Railway volume.
 *
 * Concurrency: appends are serialized through a simple Promise chain so
 * we don't interleave partial JSON lines across concurrent failures.
 *
 * Lifted from medha-imessage Newton/agent/lib/pdw/bq-dlq.js — kept in
 * sync because both services write to the same BQ tables.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";

const DLQ_PATH = process.env.MEDHA_PDW_DLQ_PATH || "/tmp/medha-pdw-dlq.jsonl";
const MAX_ATTEMPTS = 10;

let writeChain = Promise.resolve();

export async function enqueueFailedWrite(table, row, error) {
  const entry = {
    table,
    row,
    attempts: 0,
    last_error: String(error?.message || error || "unknown").slice(0, 500),
    at: new Date().toISOString(),
  };
  const line = JSON.stringify(entry) + "\n";
  writeChain = writeChain
    .then(() => fs.appendFile(DLQ_PATH, line, "utf8"))
    .catch((err) =>
      console.warn(`[pdw-dlq] enqueue failed (${DLQ_PATH}): ${err.message}`),
    );
  return writeChain;
}

export async function readDlq() {
  if (!existsSync(DLQ_PATH)) return [];
  try {
    const raw = await fs.readFile(DLQ_PATH, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    console.warn(`[pdw-dlq] read failed: ${err.message}`);
    return [];
  }
}

export async function rewriteDlq(entries) {
  const body = entries.map((e) => JSON.stringify(e)).join("\n");
  const payload = body ? body + "\n" : "";
  writeChain = writeChain
    .then(() => fs.writeFile(DLQ_PATH, payload, "utf8"))
    .catch((err) => console.warn(`[pdw-dlq] rewrite failed: ${err.message}`));
  return writeChain;
}

export function dlqPath() {
  return DLQ_PATH;
}

export function maxAttempts() {
  return MAX_ATTEMPTS;
}

export async function replayDlq(retryFn) {
  const entries = await readDlq();
  if (entries.length === 0) {
    return { tried: 0, succeeded: 0, dropped: 0, remaining: 0 };
  }
  const remaining = [];
  let succeeded = 0;
  let dropped = 0;
  for (const entry of entries) {
    let ok = false;
    try {
      ok = await retryFn(entry.table, entry.row);
    } catch (err) {
      entry.last_error = String(err?.message || err).slice(0, 500);
      ok = false;
    }
    if (ok) {
      succeeded += 1;
      continue;
    }
    entry.attempts = (entry.attempts || 0) + 1;
    if (entry.attempts >= MAX_ATTEMPTS) {
      dropped += 1;
      console.warn(
        `[pdw-dlq] dropping after ${MAX_ATTEMPTS} attempts: ${entry.table} ${entry.last_error}`,
      );
      continue;
    }
    remaining.push(entry);
  }
  await rewriteDlq(remaining);
  return {
    tried: entries.length,
    succeeded,
    dropped,
    remaining: remaining.length,
  };
}
