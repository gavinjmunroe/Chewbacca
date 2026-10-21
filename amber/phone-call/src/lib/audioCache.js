// In-memory cache of generated TTS audio. Each clip is stored under
// a random id and served back to Twilio via GET /audio/:id.
// Entries self-expire after 10 minutes to cap memory.

import crypto from "node:crypto";

const TTL_MS = 10 * 60 * 1000;
const store = new Map();

export function putAudio(buffer, contentType) {
  const id = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + TTL_MS;
  store.set(id, { buffer, contentType, expiresAt });
  return id;
}

export function getAudio(id) {
  const entry = store.get(id);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(id);
    return null;
  }
  return entry;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of store.entries()) {
    if (entry.expiresAt < now) store.delete(id);
  }
}, 60 * 1000).unref();
