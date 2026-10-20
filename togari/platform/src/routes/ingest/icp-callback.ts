/**
 * Clay → Togari callback for the website ICP list funnel.
 *
 * POST /webhooks/clay/icp-callback
 *
 * The Clay table's HTTP API column fires once its sourcing run completes,
 * posting {job_id, row_id, clay_status, rows}. Everything Clay returned is
 * stored on the job; up to 10 people with an enriched work email are then
 * emailed to the requester as a CSV, kept as tagged leads, and we get an
 * internal ping. If no one came back with a verified email, nothing is sent
 * to the requester: Slack is told to reach out personally.
 *
 * Idempotent: the job is claimed with a single compare-and-set UPDATE, so
 * Clay retries and duplicate callbacks are harmless.
 *
 * Always 200 on an authorized, well-formed request — Clay retries non-2xx,
 * and a retry storm against a terminal job is pure noise.
 *
 * Mount under /webhooks/clay BEFORE the global express.json() (same pattern
 * as createClayLeadRouter).
 */

import crypto from "crypto";
import express, { Request, Response, Router, NextFunction } from "express";
import { createLogger } from "../../observability/logger";
import {
  ClayCallbackPayload,
  isTerminalStatus,
  parseListRows,
  type JobStatus,
} from "../../icp/types";
import {
  claimCallback,
  getJob,
  recordDuplicateCallback,
  recordListEmailSent,
  updateJobStatus,
} from "../../icp/service";
import {
  notifyInternal,
  sendListEmail,
  type ThankYouContext,
} from "../../icp/email";
import { formatIcpOutcomeAlert } from "../../icp/slack";
import { selectListContacts } from "../../icp/list";
import { storeSourcedProspects } from "../../icp/lead-record";

const logger = createLogger("routes/icp-callback");

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireCallbackAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ICP_CALLBACK_KEY;
  if (!expected) {
    res.status(500).json({ error: "ICP_CALLBACK_KEY not configured" });
    return;
  }
  const provided = (req.header("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!provided || !safeEqual(provided, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

export function createIcpCallbackRouter(): Router {
  const router = express.Router();
  // strict:false so a body Clay sends as a JSON-encoded string (its code
  // steps build the payload with json.dumps) still parses; unwrapped below.
  router.use(express.json({ limit: "256kb", strict: false }));

  router.post(
    "/icp-callback",
    requireCallbackAuth,
    async (req: Request, res: Response) => {
      let body: unknown = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          body = null;
        }
      }
      const parsed = ClayCallbackPayload.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "invalid_payload",
          details: parsed.error.flatten(),
        });
      }
      const payload = parsed.data;

      try {
        const job = await getJob(payload.job_id);
        if (!job) {
          // Unknown job: log and discard (don't crash, don't make Clay retry).
          logger.warn("icp.callback.unknown_job", {
            jobId: payload.job_id,
          });
          return res.status(404).json({ error: "unknown_job" });
        }

        if (isTerminalStatus(job.status)) {
          await recordDuplicateCallback(job.job_id);
          logger.info("icp.callback.duplicate", { jobId: job.job_id });
          return res
            .status(200)
            .json({ job_id: job.job_id, status: "already_processed" });
        }

        const rows = parseListRows(payload.rows);
        const contacts = selectListContacts(rows);
        const clayStatus = payload.clay_status;
        // A list only counts if it has someone we can actually hand over.
        const nextStatus: JobStatus =
          clayStatus === "error"
            ? "failed"
            : clayStatus === "found" && contacts.length > 0
              ? "done"
              : "no_matches";

        const claimed = await claimCallback({
          jobId: job.job_id,
          status: nextStatus,
          clayStatus,
          listData: rows,
        });
        if (!claimed) {
          // Lost the race to a concurrent duplicate — never double-send.
          logger.info("icp.callback.claim_lost", { jobId: job.job_id });
          return res
            .status(200)
            .json({ job_id: job.job_id, status: "already_processed" });
        }

        const ctx: ThankYouContext = {
          job_id: job.job_id,
          full_name: job.full_name,
          email: job.email,
          industry: job.industry,
          icp_description: job.icp_description,
          company_size: job.company_size,
          target_titles: job.target_titles,
        };

        // Only a real list is emailed. With no list, nothing automated goes
        // to the requester; Slack tells us to reach out personally.
        const send = nextStatus === "done" ? await sendListEmail(ctx, contacts) : null;

        let finalStatus: JobStatus = nextStatus;
        if (send?.sent && send.messageId) {
          await recordListEmailSent(job.job_id, send.messageId);
        } else if (send?.reason === "autosend_disabled") {
          finalStatus = "done_unsent";
          await updateJobStatus(job.job_id, finalStatus);
        } else if (send) {
          finalStatus = "failed";
          await updateJobStatus(job.job_id, finalStatus, "list email send failed");
        }

        // Keep the people we found, whether or not the email went out.
        const stored =
          nextStatus === "done"
            ? await storeSourcedProspects(contacts, job)
            : { status: "skipped" as const, count: 0 };

        const requester = { ...ctx, company: job.company, lead_score: job.lead_score };
        notifyInternal(
          formatIcpOutcomeAlert(
            requester,
            finalStatus === "done"
              ? { kind: "emailed", contacts, leadsSaveFailed: stored.status === "failed" }
              : finalStatus === "done_unsent"
                ? { kind: "unsent", contacts }
                : {
                    kind: "needs_hand_build",
                    reason:
                      nextStatus === "done"
                        ? `the list email failed to send (${send?.reason ?? "unknown"})`
                        : `Clay came back ${clayStatus} with ${contacts.length} usable people (${rows.length} rows)`,
                  },
          ),
        );

        logger.info("icp.callback.processed", {
          jobId: job.job_id,
          status: finalStatus,
          rows: rows.length,
          contacts: contacts.length,
        });
        return res.status(200).json({ job_id: job.job_id, status: finalStatus });
      } catch (err) {
        logger.error(
          "icp.callback.failed",
          err instanceof Error ? err : new Error(String(err)),
        );
        return res.status(500).json({ error: "internal_error" });
      }
    },
  );

  return router;
}
