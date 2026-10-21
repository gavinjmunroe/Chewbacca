/**
 * REPORTING A USER — POST /v1/me/reports
 *
 * The fourth thing App Store Guideline 1.2 asks of an app where people see what
 * other people wrote. The other three were already here: a block (dms.js), a
 * way to remove content (clear a thread, delete an account), and published
 * contact details (Settings -> Contact support). There was no way to tell us
 * anything, and nowhere for it to land if there had been.
 *
 * ── ONE ENDPOINT, TWO WAYS IN ───────────────────────────────────────────────
 *
 *   { threadId, reason }   from inside a conversation, with evidence attached
 *   { amberId,  reason }   from a profile or a connection request, without
 *
 * Both exist because both are real. Most abuse arrives as messages, but the
 * name and photo on an impersonating profile are abuse that never sends one,
 * and an app that can only report a conversation cannot report that at all.
 *
 * ── REPORTING BLOCKS, UNLESS YOU SAY OTHERWISE ──────────────────────────────
 *
 * Somebody filing a report has already decided they want this person gone. Two
 * separate taps to achieve that, with a gap in between where the reported
 * person can still send messages, is the app making its own review process the
 * user's problem. So the block happens first, in the same request, and the
 * sheet says it will.
 *
 * The order matters: block, then file. If the insert fails, the person is still
 * protected and the failure is visible; if the block failed instead, we would
 * have a report on file and an open door, which is the worse pair.
 *
 * ── THE ANSWER IS THE SAME EITHER WAY ───────────────────────────────────────
 *
 * A report against an account that does not exist, an account already reported,
 * and an account reported for the first time all come back 200. There is no
 * information here worth handing to somebody probing for which amber_ids are
 * real -- and to the person filing it, the outcome genuinely is the same.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import { listMessages, threadCounterparty } from "../db/dm-store.js";
import { setBlock } from "../db/blocks-store.js";
import {
  DETAIL_MAX,
  EVIDENCE_MAX,
  REPORT_REASONS,
  evidenceFrom,
  fileReport,
} from "../db/reports-store.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerReportRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const store = {
    resolveAmberIdByPhone,
    threadCounterparty,
    listMessages,
    setBlock,
    fileReport,
    ...deps.store,
  };

  app.post(
    "/v1/me/reports",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["reason"],
          properties: {
            // The list is the store's, not a second copy: AJV rejecting a
            // reason the database would also reject keeps one list authoritative.
            reason: { type: "string", enum: [...REPORT_REASONS] },
            threadId: { type: "string", maxLength: 32 },
            amberId: { type: "string", maxLength: 64 },
            detail: { type: "string", maxLength: DETAIL_MAX },
            // Opt OUT, not in. Defaulting to false would mean the common case
            // has to be asked for.
            block: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!request.privyUser?.userId) {
        return reply.code(401).send({ error: "no_user", message: "Auth required" });
      }
      const phone = request.privyUser?.phone;
      const me = phone ? await store.resolveAmberIdByPhone(phone).catch(() => null) : null;
      if (!me) return reply.code(401).send({ error: "no_amber_id", message: "Account not found" });

      const body = request.body || {};
      const threadIdRaw = String(body.threadId ?? "").trim();
      const threadId = threadIdRaw && /^\d{1,18}$/.test(threadIdRaw) ? threadIdRaw : null;

      let other = null;
      let evidence = [];

      if (threadId) {
        /**
         * PARTICIPATION IS CHECKED, and it is what turns a thread id into a
         * person. Without it, posting incrementing integers would report
         * strangers to each other and read back who they are.
         */
        other = await store.threadCounterparty(Number(threadId), me).catch(() => null);
        if (!other) return reply.code(404).send({ error: "thread_not_found" });
        const messages = await store
          .listMessages(Number(threadId), me, { limit: 60 })
          .catch(() => []);
        evidence = evidenceFrom(messages, { max: EVIDENCE_MAX });
      } else {
        const claimed = String(body.amberId ?? "").trim();
        if (!UUID_RE.test(claimed)) {
          return reply.code(400).send({ error: "bad_target", message: "A thread or a person is required." });
        }
        other = claimed.toLowerCase();
      }

      if (other === me) {
        return reply.code(400).send({ error: "bad_target", message: "A thread or a person is required." });
      }

      // Block first. See the header: a failed insert leaves them protected, a
      // failed block would leave them exposed with a report on file.
      const wantsBlock = body.block !== false;
      let blocked = false;
      if (wantsBlock) {
        blocked = await store.setBlock(me, other, true).catch(() => false);
      }

      const filed = await store.fileReport({
        reporterId: me,
        reportedId: other,
        threadId,
        reason: body.reason,
        detail: body.detail ?? null,
        evidence,
      });

      if (!filed.ok && filed.error === "report_failed") {
        // The one failure worth admitting to. A user who is told "reported" and
        // was not will not report again, and the thing they were reporting keeps
        // happening. The block, if they asked for one, already stands.
        return reply.code(503).send({ error: "report_failed", blocked });
      }

      // Everything else -- an unknown account, a reason the store refused --
      // reads as filed. See the header on why this endpoint is not an oracle.
      return { ok: true, blocked };
    },
  );
}

export default registerReportRoutes;
