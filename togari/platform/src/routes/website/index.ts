/**
 * BMA website lead-capture routes — mounted under /api/v1/website.
 *
 *   POST /icp-request       — ICP wizard intake: one list per email, ever
 *                             (409 already_requested). Score, persist lead,
 *                             create job, push the brief to Clay. The only
 *                             automated email they get is the list itself,
 *                             from the Clay callback.
 *                             Returns 202.
 *   POST /contact           — contact-form intake: persist message + lead.
 *   GET  /icp-status/:job_id — status only (no PII, no list data).
 *
 * Callers are the bma-website Express proxy (never the browser — Togari's
 * CORS is wide open and keys must stay server-side). Auth is a dedicated
 * Bearer key so the website credential can be rotated independently of the
 * Clay ingest keys.
 *
 * PII discipline: request bodies are never logged — job ids and statuses only.
 */

import crypto from "crypto";
import express, { Request, Response, Router, NextFunction } from "express";
import {
  calculateAffiliation,
  extractDomainFromEmail,
  isPersonalEmailDomain,
} from "../../agents/scoring/affiliationScoring";
import { checkDncByEmail } from "../../dnc";
import { createLogger } from "../../observability/logger";
import { createFixedWindowRateLimit } from "../../middleware/ingest-rate-limit";
import { ContactMessagePayload, IcpRequestPayload } from "../../icp/types";
import {
  checkDailyCaps,
  createJob,
  findPriorRequest,
  getJob,
  insertContactMessage,
  updateJobStatus,
} from "../../icp/service";
import { notifyInternal } from "../../icp/email";
import { formatContactAlert, formatIcpOutcomeAlert } from "../../icp/slack";
import { upsertWebsiteLead } from "../../icp/lead-record";
import { pushIcpJobToClay } from "../../icp/clay-push";

const logger = createLogger("routes/website");

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireWebsiteAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.WEBSITE_INGEST_API_KEY;
  if (!expected) {
    res.status(500).json({ error: "WEBSITE_INGEST_API_KEY not configured" });
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

/** A work email is the single strongest buying signal a form can carry. */
export function isWorkEmail(email: string): boolean {
  const domain = extractDomainFromEmail(email);
  if (!domain) return false;
  return !isPersonalEmailDomain(domain);
}

/**
 * Lead score for a wizard submission. calculateQualityScore() expects an
 * enriched contact (title/phone/provenance) that a form simply doesn't have,
 * so score what the wizard actually tells us: identity, whether the work
 * email genuinely belongs to the company they claim, and how much thought
 * went into the ICP brief.
 */
export function scoreIcpLead(params: {
  full_name: string;
  email: string;
  company: string;
  company_domain: string;
  icp_description: string;
  target_titles: string[];
}): number {
  let score = 0;
  if (params.full_name.trim().length > 0) score += 10;
  if (params.email.includes("@")) score += 10;
  if (isWorkEmail(params.email)) score += 20;

  // Now that the wizard collects their domain, we can check the email
  // actually belongs to the company they named — a free-text company with a
  // mismatched email domain is the classic tyre-kicker signal.
  const affiliation = calculateAffiliation(
    { email: params.email, companyName: params.company },
    { name: params.company, website: params.company_domain },
  );
  if (affiliation.emailDomainType === "company-match") score += 20;
  else if (affiliation.emailDomainType === "unknown") score += 5;

  // A specific brief signals a real motion, not a curiosity click.
  const briefLength = params.icp_description.trim().length;
  if (briefLength >= 20) score += 20;
  else if (briefLength > 0) score += 10;
  if (params.target_titles.length > 0) score += 20;
  return Math.min(score, 100);
}

export function createWebsiteRouter(): Router {
  const router = express.Router();
  router.use(express.json({ limit: "64kb" }));

  // Backstop only: the bma-website proxy rate-limits real client IPs at
  // 5/min; Togari sees the proxy's IP, so this acts as a global ceiling.
  const perMinute = Number(process.env.WEBSITE_RATE_LIMIT_PER_MIN) || 60;
  router.use(createFixedWindowRateLimit(perMinute));

  router.post(
    "/icp-request",
    requireWebsiteAuth,
    async (req: Request, res: Response) => {
      if (process.env.ICP_PIPELINE_ENABLED !== "true") {
        return res.status(503).json({ error: "pipeline_disabled" });
      }

      const parsed = IcpRequestPayload.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "invalid_payload",
          details: parsed.error.flatten(),
        });
      }
      const p = parsed.data;

      try {
        // One free list per person: any earlier request from this email
        // (ignoring case and +tags) blocks another, before a credit is spent.
        const prior = await findPriorRequest(p.email);
        if (prior) {
          logger.info("website.icp.already_requested", { jobId: prior.job_id });
          return res.status(409).json({
            job_id: prior.job_id,
            status: prior.status,
            requested_at: prior.created_at,
            error: "already_requested",
          });
        }

        const caps = await checkDailyCaps(p.email);
        if (caps.globalCapReached || caps.requesterCapReached) {
          logger.warn("website.icp.cap_reached", {
            global: caps.globalCapReached,
            requester: caps.requesterCapReached,
          });
          return res.status(429).json({ error: "daily_cap_reached" });
        }

        // DNC is recorded, never blocking: the list email is transactional
        // (explicitly requested by the recipient).
        let dncSuppressed = false;
        try {
          const dnc = await checkDncByEmail({ email: p.email }, { tenantId: "bma" });
          dncSuppressed = dnc.suppressed;
        } catch (err) {
          logger.warn("website.icp.dnc_check_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const workEmail = isWorkEmail(p.email);
        const leadScore = scoreIcpLead({
          full_name: p.full_name,
          email: p.email,
          company: p.company,
          company_domain: p.company_domain,
          icp_description: p.icp_description,
          target_titles: p.target_titles,
        });

        const jobId = await createJob({
          full_name: p.full_name,
          email: p.email,
          company: p.company,
          company_domain: p.company_domain,
          company_description: p.company_description,
          industry: p.industry,
          icp_description: p.icp_description,
          company_size: p.company_size ?? null,
          target_titles: p.target_titles,
          client_ip: p.client_ip,
          dnc_suppressed: dncSuppressed,
          work_email: workEmail,
          lead_score: leadScore,
        });

        await upsertWebsiteLead({
          email: p.email,
          full_name: p.full_name,
          company: p.company,
          company_domain: p.company_domain,
          source_tag: "website-icp-list",
          lead_score: leadScore,
          lead_score_detail: {
            industry: p.industry,
            company_description: p.company_description,
            icp_description: p.icp_description,
            company_size: p.company_size ?? null,
            target_titles: p.target_titles,
            work_email: workEmail,
          },
        });

        const push = await pushIcpJobToClay({
          job_id: jobId,
          email: p.email,
          full_name: p.full_name,
          company: p.company,
          company_domain: p.company_domain,
          company_description: p.company_description,
          industry: p.industry,
          icp_description: p.icp_description,
          company_size: p.company_size ?? null,
          target_titles: p.target_titles,
        });

        const ctx = {
          job_id: jobId,
          full_name: p.full_name,
          email: p.email,
          company: p.company,
          lead_score: leadScore,
          industry: p.industry,
          icp_description: p.icp_description,
          company_size: p.company_size ?? null,
          target_titles: p.target_titles,
        };

        if (push.ok) {
          // No email yet: the list itself is the first and only email, sent
          // from the Clay callback. Slack hears once, when it's sent or stuck.
          await updateJobStatus(jobId, "building");
        } else {
          // Still 202: the request is recorded. No list is coming from Clay;
          // nothing automated goes to them, Slack says to reach out personally.
          await updateJobStatus(jobId, "failed", push.error);
          logger.error(
            "website.icp.clay_push_failed",
            new Error(push.error ?? "push failed"),
            { jobId },
          );
          notifyInternal(
            formatIcpOutcomeAlert(ctx, {
              kind: "needs_hand_build",
              reason: `the request could not be sent to Clay (${push.error ?? "push failed"})`,
            }),
          );
        }

        logger.info("website.icp.accepted", { jobId });
        return res.status(202).json({ job_id: jobId, status: "pending" });
      } catch (err) {
        logger.error(
          "website.icp.failed",
          err instanceof Error ? err : new Error(String(err)),
        );
        return res.status(500).json({ error: "internal_error" });
      }
    },
  );

  router.post(
    "/contact",
    requireWebsiteAuth,
    async (req: Request, res: Response) => {
      const parsed = ContactMessagePayload.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "invalid_payload",
          details: parsed.error.flatten(),
        });
      }
      const p = parsed.data;

      try {
        const messageId = await insertContactMessage(p);
        await upsertWebsiteLead({
          email: p.email,
          full_name: p.full_name,
          company_domain: extractDomainFromEmail(p.email),
          source_tag: "website-contact",
          lead_score: isWorkEmail(p.email) ? 60 : 30,
        });

        // Contact messages are time-sensitive and nobody watches BigQuery.
        notifyInternal(
          formatContactAlert({
            message_id: messageId,
            full_name: p.full_name,
            email: p.email,
            message: p.message,
          }),
        );

        logger.info("website.contact.accepted", { messageId });
        return res.status(200).json({ ok: true });
      } catch (err) {
        logger.error(
          "website.contact.failed",
          err instanceof Error ? err : new Error(String(err)),
        );
        return res.status(500).json({ error: "internal_error" });
      }
    },
  );

  router.get(
    "/icp-status/:job_id",
    requireWebsiteAuth,
    async (req: Request, res: Response) => {
      try {
        const job = await getJob(String(req.params.job_id));
        if (!job) return res.status(404).json({ error: "not_found" });
        // Status only — no PII, no list payload.
        return res.status(200).json({
          job_id: job.job_id,
          status: job.status,
          list_size: job.list_size ?? null,
          created_at: job.created_at ?? null,
        });
      } catch (err) {
        logger.error(
          "website.status.failed",
          err instanceof Error ? err : new Error(String(err)),
        );
        return res.status(500).json({ error: "internal_error" });
      }
    },
  );

  return router;
}
