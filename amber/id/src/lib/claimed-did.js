/**
 * The DID an API-key caller CLAIMS to be acting for.
 *
 * Server-to-server routes authenticate with x-api-key, which proves the caller is
 * trusted but says nothing about WHICH tenant the payload is about. That comes
 * from the body, under any of four historical spellings.
 *
 * IT IS A CLAIM, NOT AN IDENTITY. Every caller of this must resolve the value
 * against `users` before it is allowed to scope a read or a write -- a claimed
 * DID that is never checked is an API key that can read any tenant.
 *
 * Lifted out of routes/ingest.js, which was deleted with the rest of the external
 * knowledge-graph surface. Seven route files imported this one pure function from
 * it and nothing else.
 */
export function extractClaimedDid(body) {
  if (!body || typeof body !== "object") return null;
  return body.userId || body.userDid || body.privyDid || body.did || null;
}
