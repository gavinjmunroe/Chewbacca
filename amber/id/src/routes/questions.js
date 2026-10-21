/**
 * Amber Q&A routes (Phase 1 — data + endpoints, no LLM / no push yet).
 *
 *   POST   /v1/me/questions/threads              — create a thread for a question (seeds first Amber message)
 *   GET    /v1/me/questions/threads              — list caller's threads
 *   GET    /v1/me/questions/threads/:id          — {thread, messages} (404 if not owner)
 *   POST   /v1/me/questions/threads/:id/messages — append a user message (Amber's reply lands in Phase 2)
 *   POST   /v1/me/questions/threads/:id/answer   — upsert the caller's answer to the thread's question
 *   PATCH  /v1/me/answers/:id/visibility         — change an answer's visibility (owner-scoped)
 *
 * Auth: amber-id / medha-id / Privy JWT via requireAuth.
 * Owner resolution: request.privyUser.phone → resolveAmberIdByPhone → amber_id.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { requireApiKey } from "../lib/auth.js";
import { resolveAmberIdByPhone, getActiveUsers } from "../db/store.js";
import {
  getQuestion,
  createThread,
  getThread,
  listThreads,
  appendMessage,
  listMessages,
  upsertAnswer,
  setAnswerVisibility,
  deliverQuestion,
  findLiveQuestionThread,
  listInbox,
} from "../db/questions-store.js";
import { generateAmberReply, detectAnswer } from "../lib/amber-thread-chat.js";
import { notifyAmberUsers } from "../lib/notify.js";

const VALID_VISIBILITY = ["private", "network"];
const VALID_ANSWER_TYPE = ["text", "multiple_choice"];

// Resolve the caller's amber_id. Returns null and sends the appropriate error
// when auth or account resolution fails. Mirrors connections-social.js.
async function resolveOwner(request, reply) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  const phone = request.privyUser?.phone;
  const amberId = phone
    ? await resolveAmberIdByPhone(phone).catch(() => null)
    : null;
  if (!amberId) {
    reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
    return null;
  }
  return amberId;
}

// Parse and validate a route param as a positive integer. Returns the number or null.
function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function registerQuestionRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;

  // ── POST /v1/me/questions/threads ─────────────────────────────────────────
  // Create a thread anchored to a question; seed a first Amber message with the
  // question prompt. Body: { questionId }.
  app.post(
    "/v1/me/questions/threads",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["questionId"],
          properties: {
            questionId: { type: ["integer", "string"] },
          },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const questionId = parseId(request.body?.questionId);
      if (!questionId) {
        return reply
          .code(400)
          .send({ error: "invalid_question_id", message: "questionId must be a positive integer" });
      }

      const question = await getQuestion(questionId);
      if (!question) {
        return reply
          .code(404)
          .send({ error: "question_not_found", message: "No such question" });
      }

      // createThread atomically seeds the opening 'amber' message (the question
      // prompt) — a question thread can never exist without its seed message.
      const thread = await createThread({ ownerId: amberId, questionId });
      if (!thread) {
        return reply
          .code(500)
          .send({ error: "thread_failed", message: "Could not create thread" });
      }

      const messages = await listMessages(thread.id);
      return reply.code(201).send({ thread, messages });
    },
  );

  // ── GET /v1/me/questions/threads ──────────────────────────────────────────
  app.get(
    "/v1/me/questions/threads",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const threads = await listThreads(amberId);
      return { threads };
    },
  );

  // ── GET /v1/me/questions/inbox ────────────────────────────────────────────
  // Pending question inbox: delivered question-threads with no live answer yet.
  app.get(
    "/v1/me/questions/inbox",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const questions = await listInbox(amberId);
      return { questions };
    },
  );

  // ── GET /v1/me/questions/threads/:id ──────────────────────────────────────
  app.get(
    "/v1/me/questions/threads/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const threadId = parseId(request.params.id);
      if (!threadId) {
        return reply
          .code(400)
          .send({ error: "invalid_id", message: "id must be a positive integer" });
      }

      const thread = await getThread(amberId, threadId);
      if (!thread) {
        return reply.code(404).send({ error: "not_found", message: "Thread not found" });
      }
      const messages = await listMessages(threadId);
      return { thread, messages };
    },
  );

  // ── POST /v1/me/questions/threads/:id/messages ────────────────────────────
  // Append a user message. Amber's reply is generated in Phase 2.
  app.post(
    "/v1/me/questions/threads/:id/messages",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1, maxLength: 8000 },
          },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const threadId = parseId(request.params.id);
      if (!threadId) {
        return reply
          .code(400)
          .send({ error: "invalid_id", message: "id must be a positive integer" });
      }
      const content =
        typeof request.body?.content === "string" ? request.body.content.trim() : "";
      if (!content) {
        return reply
          .code(400)
          .send({ error: "content_required", message: "content is required" });
      }

      // Ownership check before any write.
      const thread = await getThread(amberId, threadId);
      if (!thread) {
        return reply.code(404).send({ error: "not_found", message: "Thread not found" });
      }

      const userMessage = await appendMessage({ threadId, role: "user", content });
      if (!userMessage) {
        return reply
          .code(500)
          .send({ error: "message_failed", message: "Could not append message" });
      }

      // Generate Amber's conversational reply. The LLM being unavailable must
      // NEVER 500 this route — the user's message is already persisted; we just
      // return amberMessage: null and iOS can retry / show the user turn.
      let amberMessage = null;
      try {
        const question = thread.questionId
          ? await getQuestion(thread.questionId)
          : null;
        const messages = await listMessages(threadId);
        const replyText = await generateAmberReply({ question, messages });
        if (replyText) {
          amberMessage = await appendMessage({
            threadId,
            role: "amber",
            content: replyText,
          });
        }
      } catch (err) {
        request.log?.warn?.(`[questions] amber reply failed: ${err?.message || err}`);
      }

      return reply.code(201).send({ userMessage, amberMessage });
    },
  );

  // ── POST /v1/me/questions/threads/:id/suggest-answer ──────────────────────
  // Detect whether the user has answered and suggest a concise answer/choice to
  // pre-fill the iOS save-answer sheet. Does NOT commit anything — committing
  // stays on POST .../answer.
  app.post(
    "/v1/me/questions/threads/:id/suggest-answer",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const threadId = parseId(request.params.id);
      if (!threadId) {
        return reply
          .code(400)
          .send({ error: "invalid_id", message: "id must be a positive integer" });
      }

      // Ownership check.
      const thread = await getThread(amberId, threadId);
      if (!thread) {
        return reply.code(404).send({ error: "not_found", message: "Thread not found" });
      }
      if (!thread.questionId) {
        return reply
          .code(400)
          .send({ error: "not_a_question_thread", message: "Thread is not anchored to a question" });
      }

      const question = await getQuestion(thread.questionId);
      if (!question) {
        return reply.code(404).send({ error: "question_not_found", message: "No such question" });
      }
      const messages = await listMessages(threadId);
      const { answered, suggestedAnswer, suggestedChoice } = await detectAnswer({
        question,
        messages,
      });
      return {
        answered,
        suggestedAnswer,
        suggestedChoice,
        answerType: question.answerType,
        options: question.options,
      };
    },
  );

  // ── POST /v1/me/questions/threads/:id/answer ──────────────────────────────
  // Upsert the caller's answer to the thread's anchored question.
  app.post(
    "/v1/me/questions/threads/:id/answer",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["answerType", "visibility"],
          properties: {
            answerType:   { type: "string" },
            answerText:   { type: "string", maxLength: 8000 },
            answerChoice: { type: "string", maxLength: 500 },
            visibility:   { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const threadId = parseId(request.params.id);
      if (!threadId) {
        return reply
          .code(400)
          .send({ error: "invalid_id", message: "id must be a positive integer" });
      }

      const body = request.body || {};
      const answerType = body.answerType;
      const visibility = body.visibility;
      if (!VALID_ANSWER_TYPE.includes(answerType)) {
        return reply.code(400).send({
          error: "invalid_answer_type",
          message: `answerType must be one of ${VALID_ANSWER_TYPE.join(", ")}`,
        });
      }
      if (!VALID_VISIBILITY.includes(visibility)) {
        return reply.code(400).send({
          error: "invalid_visibility",
          message: `visibility must be one of ${VALID_VISIBILITY.join(", ")}`,
        });
      }

      const answerText =
        typeof body.answerText === "string" ? body.answerText.trim() || null : null;
      const answerChoice =
        typeof body.answerChoice === "string" ? body.answerChoice.trim() || null : null;
      if (answerType === "text" && !answerText) {
        return reply
          .code(400)
          .send({ error: "answer_text_required", message: "answerText is required for text answers" });
      }
      if (answerType === "multiple_choice" && !answerChoice) {
        return reply.code(400).send({
          error: "answer_choice_required",
          message: "answerChoice is required for multiple_choice answers",
        });
      }

      // Ownership check + resolve the thread's anchored question.
      const thread = await getThread(amberId, threadId);
      if (!thread) {
        return reply.code(404).send({ error: "not_found", message: "Thread not found" });
      }
      if (!thread.questionId) {
        return reply
          .code(400)
          .send({ error: "not_a_question_thread", message: "Thread is not anchored to a question" });
      }

      const answer = await upsertAnswer({
        ownerId: amberId,
        questionId: thread.questionId,
        threadId,
        answerType,
        answerText,
        answerChoice,
        visibility,
      });
      if (!answer) {
        return reply
          .code(500)
          .send({ error: "answer_failed", message: "Could not save answer" });
      }
      return { answer };
    },
  );

  // ── PATCH /v1/me/answers/:id/visibility ───────────────────────────────────
  app.patch(
    "/v1/me/answers/:id/visibility",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["visibility"],
          properties: {
            visibility: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const answerId = parseId(request.params.id);
      if (!answerId) {
        return reply
          .code(400)
          .send({ error: "invalid_id", message: "id must be a positive integer" });
      }
      const visibility = request.body?.visibility;
      if (!VALID_VISIBILITY.includes(visibility)) {
        return reply.code(400).send({
          error: "invalid_visibility",
          message: `visibility must be one of ${VALID_VISIBILITY.join(", ")}`,
        });
      }

      const answer = await setAnswerVisibility({ ownerId: amberId, answerId, visibility });
      if (!answer) {
        return reply.code(404).send({ error: "not_found", message: "Answer not found" });
      }
      return { answer };
    },
  );

  // ── POST /internal/questions/deliver ──────────────────────────────────────
  // Service-gated (x-api-key, like the other /internal routes). Delivers a
  // question — i.e. ensures its seeded thread exists — to the given ownerIds,
  // or to all active users when ownerIds is omitted. Idempotent per owner.
  // Body: { questionId, ownerIds?: string[] }.
  app.post(
    "/internal/questions/deliver",
    {
      preHandler: [requireApiKey],
      schema: {
        body: {
          type: "object",
          required: ["questionId"],
          properties: {
            questionId: { type: ["integer", "string"] },
            ownerIds: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const questionId = parseId(request.body?.questionId);
      if (!questionId) {
        return reply
          .code(400)
          .send({ error: "invalid_question_id", message: "questionId must be a positive integer" });
      }

      const question = await getQuestion(questionId);
      if (!question) {
        return reply
          .code(404)
          .send({ error: "question_not_found", message: "No such question" });
      }

      // Explicit ownerIds, else every active user.
      let targets;
      if (Array.isArray(request.body?.ownerIds)) {
        targets = request.body.ownerIds
          .filter((o) => typeof o === "string" && o.trim())
          .map((o) => o.trim());
      } else {
        const users = await getActiveUsers();
        targets = users.map((u) => String(u.amber_id));
      }

      let delivered = 0; // newly created this call
      let skipped = 0; // already had a live thread
      const newDeliveries = []; // { ownerId, threadId } — only NEW ones get a push
      for (const ownerId of targets) {
        const pre = await findLiveQuestionThread(ownerId, questionId);
        const thread = await deliverQuestion({ ownerId, questionId });
        if (!thread) continue; // genuine failure — count neither
        if (pre) {
          skipped++;
        } else {
          delivered++;
          newDeliveries.push({ ownerId, threadId: String(thread.id) });
        }
      }

      // Best-effort push to NEWLY-delivered owners only. Fully isolated: any
      // failure here must NOT affect the delivery counts or the response.
      try {
        if (newDeliveries.length > 0) {
          const raw = question.prompt ?? "";
          const body = raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
          // Through notifyAmberUsers, not sendExpoPush directly. This was the one
          // remaining caller that reached the sender raw, so it threw away the
          // ticket result: dead tokens were never pruned, failures were never
          // logged as failures, and the user's own push setting was ignored. Each
          // delivery is its own call because the threadId in `data` differs per
          // recipient — that id is what makes the tap open the right thread.
          for (const { ownerId, threadId } of newDeliveries) {
            await notifyAmberUsers({
              ownerIds: [ownerId],
              title: "Amber",
              body,
              data: { type: "question", threadId: String(threadId) },
              log: request.log,
            });
          }
        }
      } catch (err) {
        request.log?.warn?.(`[questions] deliver push failed: ${err?.message || err}`);
      }

      return { delivered, skipped };
    },
  );
}
