// archive job handler.
//
// Forwards the payload to archiveRawWebhook so GCS raw archive can move
// out of the synchronous webhook path. No production code enqueues to
// this handler yet; wiring happens in a follow-up.

import {
  archiveRawWebhook,
  isArchiveReady,
} from "../../agent/lib/pdw/raw-archive.js";

export async function handle(payload) {
  if (!isArchiveReady()) {
    console.warn("[worker:archive] archive not configured; dropping job");
    return { skipped: true, reason: "archive-not-ready" };
  }
  const { payload: webhookPayload, tenant } = payload || {};
  if (!webhookPayload) {
    return { skipped: true, reason: "no-payload" };
  }
  return archiveRawWebhook(webhookPayload, tenant ? { tenant } : undefined);
}
