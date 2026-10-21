/**
 * Personal-event → Pinecone indexing.
 *
 * Every event card and every task row, written by /v1/me/events*, is
 * embedded into the user's per-tenant Pinecone namespace so the agent
 * can answer "what do I still need to do for the Rytual retreat?" via
 * semantic recall without scanning Firestore.
 *
 *   indexEvent(privyDid, event)            upsert one event vector
 *   indexTask(privyDid, event, task)       upsert one task vector
 *   deleteEventVector(privyDid, eventId)
 *   deleteTaskVector(privyDid, taskId)
 *
 * Failures NEVER throw. Firestore is the source of truth for the event /
 * task rows; Pinecone is the search accelerator and can always be
 * rebuilt via a backfill script. The endpoint that calls these treats
 * the indexing as fire-and-forget.
 */

import {
  upsert as pineconeUpsert,
  forget as pineconeForget,
} from "../service/lib/pinecone.js";
import { embed, EMBEDDING_DIMS } from "../service/lib/embed.js";
import { textForEvent, textForTask } from "../service/lib/events.js";

// These vectors predate the healthDimension write contract that
// pinecone-client.upsert() now enforces for every other writer (the contract
// the retired cNFT client owned). Opting out keeps them flowing instead of
// silently 400ing; classifying them into the six dimensions is follow-up work.
const DIMENSIONLESS = { requireDimension: false };

function vectorizationAvailable() {
  return !!(process.env.PINECONE_API_KEY && process.env.PERPLEXITY_API_KEY);
}

function eventVectorId(eventId) {
  return `event:${eventId.slice("event:".length)}`;
}

function taskVectorId(taskId) {
  return taskId;
}

/**
 * Best-effort vector upsert for a single event card. Returns
 * `{ indexed: true }` on success, `{ indexed: false, reason }` otherwise.
 */
export async function indexEvent(privyDid, event) {
  if (!privyDid || !event || !event.event_id) {
    return { indexed: false, reason: "missing_args" };
  }
  if (!vectorizationAvailable()) {
    return { indexed: false, reason: "pinecone_unavailable" };
  }
  const text = textForEvent(event);
  if (!text) return { indexed: false, reason: "empty_text" };

  let vector;
  try {
    vector = await embed(text);
  } catch (err) {
    return {
      indexed: false,
      reason: "embed_failed",
      message: err?.message || String(err),
    };
  }
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) {
    return { indexed: false, reason: "embed_wrong_dim" };
  }

  try {
    await pineconeUpsert(privyDid, [
      {
        id: eventVectorId(event.event_id),
        vector,
        text,
        kind: "event",
        source: "events/personal",
        extra: {
          event_id: event.event_id,
          title: event.title || null,
          status: event.status || null,
          start_date: event.start_date || null,
          end_date: event.end_date || null,
        },
      },
    ], DIMENSIONLESS);
    return { indexed: true };
  } catch (err) {
    return {
      indexed: false,
      reason: "pinecone_error",
      message: err?.message || String(err),
    };
  }
}

/**
 * Best-effort vector upsert for a single task row. The parent event is
 * passed in so the embedding text can mention the event title (boosts
 * recall on queries like "what's left for the retreat?").
 */
export async function indexTask(privyDid, event, task) {
  if (!privyDid || !task || !task.task_id) {
    return { indexed: false, reason: "missing_args" };
  }
  if (!vectorizationAvailable()) {
    return { indexed: false, reason: "pinecone_unavailable" };
  }
  const text = textForTask(task, event || {});
  if (!text) return { indexed: false, reason: "empty_text" };

  let vector;
  try {
    vector = await embed(text);
  } catch (err) {
    return {
      indexed: false,
      reason: "embed_failed",
      message: err?.message || String(err),
    };
  }
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) {
    return { indexed: false, reason: "embed_wrong_dim" };
  }

  try {
    await pineconeUpsert(privyDid, [
      {
        id: taskVectorId(task.task_id),
        vector,
        text,
        kind: "event_task",
        source: "events/personal",
        extra: {
          task_id: task.task_id,
          event_id: task.event_id || event?.event_id || null,
          event_title: event?.title || null,
          title: task.title || null,
          status: task.status || null,
          due_date: task.due_date || null,
        },
      },
    ], DIMENSIONLESS);
    return { indexed: true };
  } catch (err) {
    return {
      indexed: false,
      reason: "pinecone_error",
      message: err?.message || String(err),
    };
  }
}

/** Remove an event's vector when the card is deleted. Best-effort. */
export async function deleteEventVector(privyDid, eventId) {
  if (!privyDid || !eventId) return { deleted: false };
  if (!vectorizationAvailable()) {
    return { deleted: false, reason: "pinecone_unavailable" };
  }
  try {
    await pineconeForget(privyDid, { ids: [eventVectorId(eventId)] });
    return { deleted: true };
  } catch {
    return { deleted: false, reason: "pinecone_error" };
  }
}

/** Remove a task's vector when the task is deleted. Best-effort. */
export async function deleteTaskVector(privyDid, taskId) {
  if (!privyDid || !taskId) return { deleted: false };
  if (!vectorizationAvailable()) {
    return { deleted: false, reason: "pinecone_unavailable" };
  }
  try {
    await pineconeForget(privyDid, { ids: [taskVectorId(taskId)] });
    return { deleted: true };
  } catch {
    return { deleted: false, reason: "pinecone_error" };
  }
}
