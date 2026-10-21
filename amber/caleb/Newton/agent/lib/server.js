import { createServer } from "http";
import { normalizeHandle } from "./permissions.js";
import { contactMemoryCache, conversationMemoryCache } from "./contacts.js";
import {
  PERPLEXITY_API_KEY,
  EXA_API_KEY,
  AMBER_ID_API_URL,
} from "./constants.js";
import { matchesTiwariProxy, handleTiwariProxy } from "./tiwari-proxy.js";
import {
  matchesNetworkProxy,
  handleNetworkProxy,
} from "../connection-network/consumer/network-proxy.js";
import {
  matchesPeopleRankProxy,
  handlePeopleRankProxy,
} from "../peoplerank/consumer/peoplerank-proxy.js";
import { showTyping } from "./transport.js";
import { resolveTenant, resolveTenantStrict } from "./tenant.js";
import { buildAmberVcard, vcardFilename } from "./vcard.js";
import {
  verifyWebhook,
  checkAdminAuth,
  resolveCorsOrigin,
} from "./webhook-auth.js";
import { extractPrivyToken, verifyPrivyJwt } from "./privy.js";
import { markSeen, inboundDedupeKey } from "./idempotency.js";
import { allBreakerStatus } from "./circuit-breaker.js";
import { slackEventsHandler } from "./transports/slack/index.js";
import {
  validateQuickCallInput,
  buildQuickCallEnvelope,
  fetchCallerIdentity,
} from "./quick-call.js";
import { computeStreamBudget } from "./stream-budget.js";
import {
  buildStreamError,
  statusToStreamErrorCode,
  buildProgressFrame,
} from "./stream-frames.js";

/**
 * Starts the HTTP server for Loop Message webhooks and status monitoring.
 */
export async function startServer(deps) {
  const {
    enqueueMessage,
    sendMessage,
    sendTapback,
    getPlatformStatus,
    getState,
  } = deps;

  const PORT = process.env.PORT || 10000;
  const MAX_BODY_BYTES = 1024 * 1024; // 1MB
  const IS_PROD = process.env.NODE_ENV === "production";

  // How long (seconds) to show the typing indicator when a DM comes in.
  // Amber tends to reply in 3–12s; a 10s typing bubble feels honest
  // without being alarming when the reply is fast.
  const TYPING_SECONDS = Math.max(
    1,
    Math.min(60, parseInt(process.env.LOOP_TYPING_SECONDS || "10", 10)),
  );

  // M2: per-tenant concurrent /quick-call/stream cap. In-memory counter keyed
  // by the caller's identity (DID, falling back to phone). Each open stream
  // increments on accept and decrements on finish/close; over the cap returns
  // 429. Bounds the blast radius of a misbehaving client opening sockets in a
  // loop without standing up a full rate limiter.
  const QUICK_CALL_STREAM_MAX_CONCURRENT = Math.max(
    1,
    parseInt(process.env.QUICK_CALL_STREAM_MAX_CONCURRENT || "3", 10),
  );
  const quickCallStreamCounts = new Map();

  // Soft Privy verification for the in-app endpoints.
  //
  // The iOS app authenticates with a medha-id SESSION JWT minted by the
  // warm-OTP flow (/v1/auth/verify-code-only), NOT a Privy token. medha-id's
  // requireAuth accepts that token family; medha-platform's verifyPrivyJwt
  // (Privy ES256 / JWKS only) does not. A hard requirePrivyAuth gate therefore
  // 401-rejected every in-app Medha request before identity ever ran.
  //
  // medha-id is the single auth authority ("every other service goes through
  // amber-id"), so the authoritative gate for these endpoints is the
  // medha-id /v1/me call inside resolveQuickCallIdentity below — it accepts a
  // Privy token OR a medha-id session JWT and returns the caller's own phone +
  // loop sender. This helper is best-effort: if a Privy token IS present we
  // capture its DID for the identity cross-check; any verification failure
  // (e.g. a medha-id session JWT) is non-fatal and falls through to /v1/me.
  const softPrivyAuth = async (req) => {
    try {
      const token = extractPrivyToken(req);
      if (token) req.privy = await verifyPrivyJwt(token);
    } catch {
      // Not a Privy token (the app sends a medha-id session JWT). /v1/me is
      // the authoritative auth gate; leave req.privy unset.
    }
  };

  // Resolve the caller's identity for an in-app request and assert it.
  //
  // Derives the bearer token once and forwards it to medha-id /v1/me as a
  // Bearer header regardless of which header the client used. medha-id both
  // authenticates the token and returns the caller's phone + loop sender; a
  // 401 from /v1/me is a real auth failure, surfaced as 401 to the client.
  //
  // Identity assertion: when a Privy token WAS locally verified (req.privy.did
  // is set), it MUST match the identity /v1/me returns — fail closed on a
  // mismatch (the /admin/say-as-user attribution bug class). For medha-id
  // session tokens req.privy is unset and this cross-check is skipped, since
  // /v1/me derived the identity from the same verified token.
  //
  // Returns { ok: true, phoneNumber, loopSenderId } or
  // { ok: false, status, error } shaped for an HTTP response.
  const resolveQuickCallIdentity = async (req) => {
    const verifiedToken = extractPrivyToken(req);
    const identity = await fetchCallerIdentity({
      apiUrl: AMBER_ID_API_URL,
      authorization: verifiedToken ? `Bearer ${verifiedToken}` : "",
    });
    if (!identity.ok) {
      console.warn(
        `[quick-call] identity not resolved: status=${identity.status || "—"} error=${identity.error || "—"} upstream=${identity.upstreamStatus || "—"}`,
      );
      return identity;
    }
    const verifiedDid = req.privy?.did || null;
    const identityDid = identity.did || identity.privyDid || null;
    if (verifiedDid && identityDid && verifiedDid !== identityDid) {
      console.warn(
        `[quick-call] DID mismatch: token=${verifiedDid} /v1/me=${identityDid} — rejecting`,
      );
      return { ok: false, status: 401, error: "identity_mismatch" };
    }
    return identity;
  };

  if (
    !process.env.WEBHOOK_SECRET &&
    !process.env.LOOP_WEBHOOK_SECRET &&
    !process.env.TWILIO_AUTH_TOKEN
  ) {
    if (IS_PROD) {
      console.error(
        "[SECURITY] No webhook auth configured in production. Webhook " +
          "endpoints will reject all requests. Set LOOP_WEBHOOK_SECRET, " +
          "TWILIO_AUTH_TOKEN, or WEBHOOK_SECRET.",
      );
    } else {
      console.warn(
        "[SECURITY] No webhook auth configured. Allowing webhooks in dev only.",
      );
    }
  }

  // CORS allowlist validation: in production, CORS_ALLOWED_ORIGINS must be
  // set so preflight requests are gated to explicit origins. An absent
  // allowlist means ALL origins are rejected by resolveCorsOrigin in
  // production — iOS app calls will fail with 403. Log loudly so this is
  // never silently deployed.
  if (IS_PROD && !process.env.CORS_ALLOWED_ORIGINS) {
    console.error(
      "[SECURITY] CORS_ALLOWED_ORIGINS is not set in production. All " +
        "cross-origin preflight requests will be rejected (403). Set " +
        "CORS_ALLOWED_ORIGINS to a comma-separated list of allowed origins " +
        "(e.g. https://app.amber.ai,capacitor://localhost).",
    );
  }

  // Ring buffer of the last 20 webhook payloads so we can debug multi-tenant
  // routing via GET /debug/recent-webhooks without tailing Railway logs.
  const RECENT_WEBHOOKS = [];

  function recordWebhook(payload) {
    try {
      RECENT_WEBHOOKS.push({
        at: new Date().toISOString(),
        event: payload?.event || null,
        keys: payload ? Object.keys(payload) : [],
        payload,
      });
      while (RECENT_WEBHOOKS.length > 20) RECENT_WEBHOOKS.shift();
    } catch {}
  }

  // Validate Loop Message webhook payload shape
  function validateLoopPayload(payload) {
    if (!payload || typeof payload !== "object")
      return "payload must be an object";
    if (payload.event && typeof payload.event !== "string")
      return "event must be a string";
    if (payload.text && typeof payload.text !== "string")
      return "text must be a string";
    if (payload.contact && typeof payload.contact !== "string")
      return "contact must be a string";
    if (payload.from && typeof payload.from !== "string")
      return "from must be a string";
    return null;
  }

  // Webhook auth: signature verification when a provider secret is set,
  // shared-secret fallback otherwise. The function takes the raw request
  // body when available (Loop signatures sign the bytes; URL+form for
  // Twilio). For endpoints that haven't read the body yet we pass null
  // and rely on shared-secret/admin-token only.
  function checkWebhookAuth(req, rawBody = null) {
    const result = verifyWebhook(req, rawBody);
    if (!result.ok) {
      console.warn(
        `[webhook-auth] reject ${req.method} ${req.url}: ${result.reason}`,
      );
    }
    return result.ok;
  }

  // Lazy-load the voice-turn handler so amber-phone-call can route each
  // inbound phone-call speech turn through the real Amber brain.
  const { handleVoiceTurn, endVoiceSession } = await import("./voice-turn.js");

  // flaw #11 — best-effort hydrate the global suppression list from
  // medha-id on boot. Never throws; if the endpoint isn't live yet we
  // silently fall back to in-memory-only behavior.
  try {
    const { hydrateSuppressions } = await import("./suppressions.js");
    hydrateSuppressions().catch(() => {});
  } catch {}

  // Read a request body with a hard byte cap. Used by JSON endpoints.
  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error("body too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve(raw ? JSON.parse(raw) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
    });
  }

  const server = createServer(async (req, res) => {
    // ── CORS preflight (Tiwari proxy is called from iOS + web) ───────────
    // Origins are gated by CORS_ALLOWED_ORIGINS in production; in dev we
    // echo the request origin so local clients keep working.
    if (req.method === "OPTIONS") {
      const allowOrigin = resolveCorsOrigin(req);
      if (!allowOrigin) {
        // Origin not on allowlist — refuse the preflight without
        // emitting permissive CORS headers so the browser blocks the
        // real request.
        res.writeHead(403);
        res.end();
        return;
      }
      const headers = {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type,Authorization,X-Admin-Token,X-Webhook-Secret",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      };
      // Only allow credentials when we're echoing a specific origin (the
      // CORS spec disallows `*` + credentials).
      if (allowOrigin !== "*") {
        headers["Access-Control-Allow-Credentials"] = "true";
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }

    // ── Tiwari proxy (iOS -> amber-agent -> Tiwari ES modules) ───────────
    // Handles: /api/tiwari/peoplerank, /api/tiwari/enrich,
    //          /api/tiwari/opportunity, /api/ask, /api/identity/me
    if (matchesTiwariProxy(req)) {
      await handleTiwariProxy(req, res);
      return;
    }

    // ── UnifyNetwork consumer surface (amber-ios -> connection graph) ────
    // Handles /v1/network/check, /identities, /identities/{id},
    // /connections (BigQuery via the ported FastAPI engine) and
    // /v1/network/search (Pinecone via search_contacts). Auth = the same
    // medha-id Privy JWT as /api/ask/stream; every response is caller-scoped.
    if (matchesNetworkProxy(req)) {
      await handleNetworkProxy(req, res);
      return;
    }

    // ── PeopleRank consumer surface (amber-ios -> ranked network search) ─
    // POST /v1/peoplerank/search ranks the caller's unified network against
    // a natural-language query using the ported PeopleRank scoring +
    // rationale. Same medha-id Privy JWT auth as /v1/network/*; the same
    // search_contacts Pinecone path supplies the candidates.
    if (matchesPeopleRankProxy(req)) {
      await handlePeopleRankProxy(req, res);
      return;
    }

    // ── Voice-turn endpoint for amber-phone-call ─────────────────────────
    // Each speech turn of an inbound phone call arrives here. We run the
    // full Amber pipeline (Claude + Perplexity embeddings + Perplexity
    // deep search + relational memory) and return the reply text so the
    // voice adapter can synthesize it via ElevenLabs.
    if (req.method === "POST" && req.url === "/api/voice-turn") {
      if (!checkWebhookAuth(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }),
        );
        return;
      }
      try {
        const body = await readJsonBody(req);
        const { callSid, caller, userText } = body || {};
        if (!callSid || typeof callSid !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "callSid required",
              code: "MISSING_CALL_SID",
            }),
          );
          return;
        }
        const result = await handleVoiceTurn({ callSid, caller, userText });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error("[voice-turn] error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            reply: "Sorry, I blanked. Say that again?",
            error: "voice_turn_failed",
            code: "VOICE_TURN_ERROR",
          }),
        );
      }
      return;
    }

    if (req.method === "POST" && req.url === "/api/voice-turn/end") {
      if (!checkWebhookAuth(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }),
        );
        return;
      }
      try {
        const body = await readJsonBody(req);
        const result = await endVoiceSession({ callSid: body?.callSid });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error("[voice-turn/end] error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "end_failed", code: "VOICE_END_ERROR" }),
        );
      }
      return;
    }

    // ── Public Amber vCard ─────────────────────────────────────
    // GET /v1/vcard/<loop-sender-uuid>.vcf returns the public Amber
    // contact card for the tenant that owns that sender. Loop's
    // `contact_file` field on /api/v1/message/send/ dereferences a
    // URL and attaches the result as an iMessage contact bubble, so
    // this is the address we pass when Amber sends "save my contact".
    //
    // No auth: the file contains only the public Amber name + the
    // tenant's public iMessage sender phone (already broadcast on
    // every message Amber sends). It MUST NEVER include the human
    // owner's name or phone — see vcard.js for the identity rules.
    if (req.method === "GET" && req.url.startsWith("/v1/vcard/")) {
      const match = req.url.match(
        /^\/v1\/vcard\/([^/?#]+?)(?:\.vcf)?(?:\?.*)?$/,
      );
      const senderId = match ? decodeURIComponent(match[1]) : null;
      if (!senderId) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found", code: "NOT_FOUND" }));
        return;
      }
      const tenant = await resolveTenant(senderId).catch(() => null);
      const body = tenant ? buildAmberVcard(tenant) : null;
      if (!body) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unknown sender", code: "NOT_FOUND" }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/vcard; charset=utf-8",
        "Content-Disposition": `inline; filename="${vcardFilename(tenant)}"`,
        // Short cache — tenants rarely change but operators want a quick
        // fix path if the public name or phone ever updates.
        "Cache-Control": "public, max-age=300",
      });
      res.end(body);
      return;
    }

    // ── Ephemeral audio host ───────────────────────────────────
    // Serves MP3s produced by lib/voice.js so Loop can fetch them when
    // forwarding an iMessage voice-note attachment. Public route, no
    // auth — the only thing it ever returns is one of the ~50 buffers
    // currently in the in-memory store, addressed by random short id.
    // IDs are 8 hex chars (32 bits of entropy) and entries TTL after 10
    // minutes, so even if someone scrapes /audio/ they get nothing.
    if (req.method === "GET" && req.url.startsWith("/audio/")) {
      const m = req.url.match(/^\/audio\/([a-f0-9]{4,32})\.mp3(?:\?.*)?$/i);
      const id = m ? m[1] : null;
      if (!id) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found", code: "NOT_FOUND" }));
        return;
      }
      try {
        const { getAudio } = await import("./voice.js");
        const buf = getAudio(id);
        if (!buf) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "expired", code: "GONE" }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(buf.length),
          "Cache-Control": "public, max-age=600",
        });
        res.end(buf);
        return;
      } catch (err) {
        console.warn(`[audio-host] serve failed: ${err.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal_error" }));
        return;
      }
    }

    // ── Ephemeral image host ──────────────────────────────────
    // Mirror of /audio/ for PNGs produced by lib/tools/image-gen.js.
    // Same id shape (8 hex chars), same 10-min TTL, same no-auth public
    // route. Loop fetches the URL once when the outbound iMessage is
    // dispatched; nothing else should be reading it.
    if (req.method === "GET" && req.url.startsWith("/image/")) {
      const m = req.url.match(
        // PDF added so Slack-uploaded PDFs (proxied through the bot-token
        // auth wall by lib/transports/slack/envelope.js) can be served as a
        // plain public URL into Mistral OCR. Same TTL, same id shape, no auth.
        // PR #239 (generate_pdf) also serves outbound PDFs through this
        // route so Loop can fetch /image/<id>.pdf as a real iMessage
        // attachment.
        // PR-G (generate_docx / generate_xlsx / generate_csv / md / txt /
        // json / code_file) widens the regex to accept the office + text
        // family so outbound documents land on the same public path.
        // Tab 24 (analyze_tabular) adds svg so hand-rolled charts resolve.
        /^\/image\/([a-f0-9]{4,32})\.(png|jpg|jpeg|webp|pdf|docx|xlsx|csv|md|txt|json|svg)(?:\?.*)?$/i,
      );
      const id = m ? m[1] : null;
      if (!id) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found", code: "NOT_FOUND" }));
        return;
      }
      try {
        const { getImage } = await import("./image-host.js");
        const entry = getImage(id);
        if (!entry) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "expired", code: "GONE" }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": entry.mimeType || "image/png",
          "Content-Length": String(entry.buffer.length),
          "Cache-Control": "public, max-age=600",
        });
        res.end(entry.buffer);
        return;
      } catch (err) {
        console.warn(`[image-host] serve failed: ${err.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal_error" }));
        return;
      }
    }

    // ── Admin: send a voice note (test harness) ────────────────
    // POST /admin/send-voice with {to, text} and X-Admin-Token header.
    // Generates speech via lib/voice.js, stashes the MP3 in the audio
    // host, and sends it through Loop as a voice-note attachment under
    // the Medha-expert sender. This is the path we use to validate the
    // whole audio pipeline end-to-end without needing the model in the
    // loop. Gated by ADMIN_TOKEN — refuses entirely when unset.
    if (req.method === "POST" && req.url === "/admin/send-voice") {
      if (!checkAdminAuth(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      // readJsonBody already returns the parsed object; don't re-parse.
      let payload = {};
      try {
        payload = (await readJsonBody(req)) || {};
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || "invalid_json" }));
        return;
      }
      const to = String(payload.to || "").trim();
      const text = String(payload.text || "").trim();
      if (!to || !text) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "to and text are required" }));
        return;
      }
      try {
        const { generateSpeech, storeAudio, isVoiceAvailable } =
          await import("./voice.js");
        if (!isVoiceAvailable()) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" }),
          );
          return;
        }
        const audioBuffer = await generateSpeech(text);
        if (!audioBuffer) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "tts_generation_failed" }));
          return;
        }
        const id = storeAudio(audioBuffer);
        const publicBase =
          process.env.PUBLIC_BASE_URL ||
          (process.env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : null);
        if (!id || !publicBase) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "no_public_base_url_or_store_failed" }),
          );
          return;
        }
        const audioUrl = `${publicBase}/audio/${id}.mp3`;

        // Resolve the Medha-expert tenant so the Loop sender ID + signing
        // come from the right place. No user-tenant impersonation here —
        // we're sending FROM Medha, not as a user.
        const expertSenderId = process.env.MEDHA_EXPERT_SENDER_ID;
        const tenant = expertSenderId
          ? await resolveTenant(expertSenderId).catch(() => null)
          : null;

        // Send: text is the "transcript" Loop renders below the bubble;
        // mediaUrl is the audio that plays.
        const sent = await sendMessage(to, text, {
          tenant,
          mediaUrl: audioUrl,
          // Skip iMessage formatting — voice notes don't need markdown.
          skipFormatting: true,
          auditOrigin: "admin",
          webhookContact: to,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            audio_url: audioUrl,
            bytes: audioBuffer.length,
            sent,
          }),
        );
        return;
      } catch (err) {
        console.error(`[admin/send-voice] failed: ${err.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }

    // ── Admin: send a plain text message ───────────────────────
    // POST /admin/send-message with { to, text } and X-Admin-Token.
    // Sends a text iMessage from Medha to `to`. Used by medha-id to
    // deliver dashboard OTP codes ("Your Medha sign-in code: 123456")
    // and by any future operator-trigger flow that needs a text send.
    // Gated by ADMIN_TOKEN. The 'tenant' is the Medha-expert tenant so
    // the message comes from the same Loop sender Medha uses everywhere.
    if (req.method === "POST" && req.url === "/admin/send-message") {
      if (!checkAdminAuth(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      let payload = {};
      try {
        payload = (await readJsonBody(req)) || {};
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || "invalid_json" }));
        return;
      }
      const to = String(payload.to || "").trim();
      const text = String(payload.text || "").trim();
      if (!to || !text) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "to and text are required" }));
        return;
      }
      try {
        const expertSenderId = process.env.MEDHA_EXPERT_SENDER_ID;
        const tenant = expertSenderId
          ? await resolveTenant(expertSenderId).catch(() => null)
          : null;
        // allowDuplicate: admin sends are explicitly intentional (OTP
        // delivery, dashboard relays, operator-triggered messages). The
        // transport's 60s dedup window otherwise silently drops a second
        // OTP whose text matches a recent one (the OTP store returns the
        // same throttled code on quick re-requests), and medha-id sees
        // 200 / frontend renders "we texted you" when nothing went out.
        const sent = await sendMessage(to, text, {
          tenant,
          allowDuplicate: true,
          auditOrigin: "admin",
          webhookContact: to,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, sent }));
        return;
      } catch (err) {
        console.error(`[admin/send-message] failed: ${err.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }

    // ── Quick-call: public twin of /admin/say-as-user ──────────
    // POST /api/v1/quick-call with { text } and a Privy Bearer JWT.
    // Resolves the caller's own phoneNumber + loopSenderId via
    // medha-id /v1/me, synthesizes a Loop-shaped webhook, and runs it
    // through the same dispatchLoopEvent the iMessage handler uses.
    // This is the backend the iOS Shortcut (Siri / Action Button /
    // Back Tap / Share Sheet) points at. Auth differs from
    // /admin/say-as-user (Privy instead of admin token); dispatch rail
    // is identical.
    if (req.method === "POST" && req.url === "/api/v1/quick-call") {
      // Auth via medha-id /v1/me (accepts Privy OR medha-id session JWT).
      await softPrivyAuth(req);
      let body = {};
      try {
        body = (await readJsonBody(req)) || {};
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || "invalid_json" }));
        return;
      }
      const inputCheck = validateQuickCallInput(body);
      if (!inputCheck.ok) {
        res.writeHead(inputCheck.status, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({
            error: inputCheck.error,
            ...(inputCheck.max ? { max: inputCheck.max } : {}),
          }),
        );
        return;
      }
      const identity = await resolveQuickCallIdentity(req);
      if (!identity.ok) {
        res.writeHead(identity.status, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify({ error: identity.error }));
        return;
      }
      const envelope = buildQuickCallEnvelope({
        phoneNumber: identity.phoneNumber,
        loopSenderId: identity.loopSenderId,
        text: inputCheck.text,
      });
      recordWebhook(envelope);
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message_id: envelope.message_id }));
      // Fire-and-forget: don't make the Shortcut wait on the full
      // 5-12s agent loop. The reply comes back as an iMessage to the
      // caller, not as the HTTP response.
      dispatchLoopEvent(envelope, {
        enqueueMessage,
        sendMessage,
        sendTapback,
        typingSeconds: TYPING_SECONDS,
      }).catch((err) =>
        console.warn(`[api/v1/quick-call] dispatch failed: ${err.message}`),
      );
      return;
    }

    // ── Togari chat proxy (in-app) ──
    // POST /api/v1/togari/message with { text } and a Privy Bearer JWT.
    // Bridges the iOS Togari toggle to togari-platform's universal NL endpoint
    // (POST {TOGARI_PLATFORM_URL}/api/v1/message, the same processMessage
    // pipeline the Slack + iMessage transports use). The shared X-Togari-Key
    // lives server-side here, never in the client bundle, and user_id is
    // derived from the verified caller rather than client-supplied. This is a
    // thin authed bridge: per-tenant entitlement gating is intentionally
    // deferred per product decision and will be layered on later. Returns the
    // platform's { success, data: { type, text } } shape verbatim so the app's
    // askTogari parser consumes it unchanged.
    if (req.method === "POST" && req.url === "/api/v1/togari/message") {
      // Auth via medha-id /v1/me (accepts Privy OR medha-id session JWT).
      await softPrivyAuth(req);
      let body = {};
      try {
        body = (await readJsonBody(req)) || {};
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || "invalid_json" }));
        return;
      }
      const inputCheck = validateQuickCallInput(body);
      if (!inputCheck.ok) {
        res.writeHead(inputCheck.status, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({
            error: inputCheck.error,
            ...(inputCheck.max ? { max: inputCheck.max } : {}),
          }),
        );
        return;
      }
      const identity = await resolveQuickCallIdentity(req);
      if (!identity.ok) {
        res.writeHead(identity.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: identity.error }));
        return;
      }

      const togariPlatformUrl = (
        process.env.TOGARI_PLATFORM_URL ||
        process.env.TOGARI_API_URL ||
        ""
      )
        .trim()
        .replace(/\/+$/, "");
      const togariKey = (process.env.TOGARI_API_KEY || "").trim();
      if (!togariPlatformUrl || !togariKey) {
        // Match the client's fail-safe contract: a 424 with togari_not_configured
        // so the app shows "Togari is not available yet" instead of an error.
        res.writeHead(424, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "togari_not_configured",
            message: "Togari is not available yet.",
          }),
        );
        return;
      }

      try {
        const tgRes = await fetch(`${togariPlatformUrl}/api/v1/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-togari-key": togariKey,
          },
          body: JSON.stringify({
            message: inputCheck.text,
            user_id: identity.phoneNumber,
            context: {
              source: "amber-ios",
              phone: identity.phoneNumber,
              did: identity.did || identity.privyDid || null,
            },
          }),
          signal: AbortSignal.timeout(
            Number(process.env.TOGARI_PLATFORM_TIMEOUT_MS) || 25_000,
          ),
        });

        if (tgRes.status === 401) {
          console.error(
            "[api/v1/togari/message] togari-platform rejected X-Togari-Key (401)",
          );
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "togari_upstream_unauthorized",
              message: "Togari is not available right now.",
            }),
          );
          return;
        }
        if (!tgRes.ok) {
          const detail = await tgRes.text().catch(() => "");
          console.error(
            `[api/v1/togari/message] togari-platform ${tgRes.status}: ${detail.slice(0, 300)}`,
          );
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: `togari_upstream_${tgRes.status}`,
              message: "Togari had a problem. Try again shortly.",
            }),
          );
          return;
        }

        const json = await tgRes.json().catch(() => null);
        const text = json?.data?.text;
        if (
          !json ||
          json.success !== true ||
          typeof text !== "string" ||
          text.length === 0
        ) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "empty_response",
              message: "Togari returned no text.",
            }),
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: { type: json.data?.type || "text", text },
          }),
        );
      } catch (err) {
        const aborted =
          err?.name === "AbortError" || err?.name === "TimeoutError";
        console.error(
          `[api/v1/togari/message] proxy failed: ${err?.message || err}`,
        );
        res.writeHead(aborted ? 504 : 502, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({
            error: aborted ? "togari_timeout" : "togari_proxy_failed",
            message: "Togari is not responding. Try again shortly.",
          }),
        );
      }
      return;
    }

    // ── Quick-call (streaming): in-app twin of /api/v1/quick-call ──
    // POST /api/v1/quick-call/stream with { text } and a Privy Bearer JWT.
    // Runs the SAME tool-using agent loop as iMessage (calendar / email /
    // drive), but captures the reply via reply-capture.js and streams it
    // back as SSE so the iOS app shows tool-Medha inline instead of the
    // answer landing in Messages. Frames match the app parser:
    // token (per segment) -> done -> complete, or error.
    if (req.method === "POST" && req.url === "/api/v1/quick-call/stream") {
      // Auth via medha-id /v1/me (accepts Privy OR medha-id session JWT).
      await softPrivyAuth(req);
      let body = {};
      try {
        body = (await readJsonBody(req)) || {};
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || "invalid_json" }));
        return;
      }
      const inputCheck = validateQuickCallInput(body);
      if (!inputCheck.ok) {
        res.writeHead(inputCheck.status, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({
            error: inputCheck.error,
            ...(inputCheck.max ? { max: inputCheck.max } : {}),
          }),
        );
        return;
      }
      const identity = await resolveQuickCallIdentity(req);
      if (!identity.ok) {
        // Item 199: still a pre-stream JSON error (headers not yet written), but
        // carry the structured envelope the app maps to mint / upgrade / retry
        // UI rather than a bare error string.
        const code = statusToStreamErrorCode(identity.status, identity.error);
        res.writeHead(identity.status, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(buildStreamError(code, { detail: identity.error })),
        );
        return;
      }

      // M2: per-tenant concurrency cap. Key by DID (stable) and fall back to
      // phone. Reserve the slot BEFORE writing the SSE headers so an over-cap
      // request gets a clean JSON 429 instead of a half-open event stream.
      const streamKey =
        identity.did || identity.privyDid || identity.phoneNumber || "unknown";
      const activeForKey = quickCallStreamCounts.get(streamKey) || 0;
      if (activeForKey >= QUICK_CALL_STREAM_MAX_CONCURRENT) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "too_many_concurrent_streams",
            max: QUICK_CALL_STREAM_MAX_CONCURRENT,
          }),
        );
        return;
      }
      quickCallStreamCounts.set(streamKey, activeForKey + 1);
      // Decrement exactly once across every exit path (finish / client close /
      // error). Guarded so double-release can't drive the counter negative.
      let slotReleased = false;
      const releaseStreamSlot = () => {
        if (slotReleased) return;
        slotReleased = true;
        const n = quickCallStreamCounts.get(streamKey) || 0;
        if (n <= 1) quickCallStreamCounts.delete(streamKey);
        else quickCallStreamCounts.set(streamKey, n - 1);
      };

      const envelope = buildQuickCallEnvelope({
        phoneNumber: identity.phoneNumber,
        loopSenderId: identity.loopSenderId,
        text: inputCheck.text,
      });
      recordWebhook(envelope);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const send = (event, data) => {
        if (!res.writableEnded) {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
      };

      // Item 190 (perceived latency): emit an immediate "thinking" progress
      // frame the moment the stream opens — well under 400ms — so the app
      // shows activity instead of an idle bubble while the model warms up and
      // the first context loads.
      send("progress", buildProgressFrame("thinking", "Thinking"));

      // The agent flushes replies asynchronously (burst batching + segment
      // splitting) with no explicit "done" signal on this path, so we settle
      // a short beat after the last captured segment, with a hard ceiling so
      // a silent run can't hold the socket open forever.
      let full = "";
      let streamError = null;
      let settled = false;
      let dispatchDone = false;
      let settle = () => {};
      let quietTimer = null;
      let noOutputTimer = null;
      let lastProgressLabel = "Thinking";
      const done = new Promise((resolve) => {
        settle = resolve;
      });
      // Item 192: settle budget tuned to the turn class. A plain conversation
      // turn answers in seconds and shouldn't ride the slow-tool window before
      // we conclude "no reply"; a calendar/research turn legitimately needs the
      // full slow window before its first segment. computeStreamBudget picks
      // both the no-output settle and the absolute hard cap from the inbound
      // text. A captured segment cancels the no-output timer regardless, so a
      // misclassified turn can never truncate a reply that already arrived.
      const {
        turnClass,
        noOutputMs: NO_OUTPUT_MS,
        hardCapMs,
      } = computeStreamBudget(inputCheck.text);
      // finish() is the single idempotent exit. It clears EVERY timer
      // (quiet-settle, no-output-settle, hard cap) and releases the M2 slot
      // so no exit path can leak a timer or a concurrency reservation.
      const finish = () => {
        if (settled) return;
        settled = true;
        if (quietTimer) clearTimeout(quietTimer);
        if (noOutputTimer) clearTimeout(noOutputTimer);
        clearTimeout(hardTimeout);
        releaseStreamSlot();
        settle();
      };
      const QUIET_MS = 2500;
      // Absolute hard cap — a run that somehow never settles still ends.
      const hardTimeout = setTimeout(finish, hardCapMs);
      // "No-output" settle. A run that legitimately sends nothing (the agent
      // decided not to reply) shouldn't ride the full hard cap. Once the
      // dispatch promise has resolved AND no segment/error has arrived within
      // this window, finish with empty_response. Re-armed when dispatch
      // resolves so we don't fire while the agent is still mid-run.
      const armNoOutputTimer = () => {
        if (noOutputTimer) clearTimeout(noOutputTimer);
        noOutputTimer = setTimeout(() => {
          if (!full && !streamError && dispatchDone) finish();
        }, NO_OUTPUT_MS);
      };
      armNoOutputTimer();
      const onMessage = (text) => {
        if (typeof text === "string" && text.length > 0) {
          send("token", { delta: full ? `\n${text}` : text });
          full = full ? `${full}\n${text}` : text;
        }
        // First real output cancels the no-output settle and switches to the
        // quiet-settle that waits a beat for trailing segments.
        if (noOutputTimer) {
          clearTimeout(noOutputTimer);
          noOutputTimer = null;
        }
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, QUIET_MS);
      };
      // Item 191: tool-execution progress. The dispatcher calls emitProgress as
      // each tool starts; it arrives here via the capture context. Stream a
      // `progress` frame so the app can show "Checking your calendar". Dedupe
      // repeated identical labels (the model often calls the same tool family
      // several times in one turn) and never emit progress once a real segment
      // has started landing.
      const onProgress = (phase, label) => {
        if (settled || full) return;
        if (!label || label === lastProgressLabel) return;
        lastProgressLabel = label;
        send("progress", buildProgressFrame(phase, label));
      };
      // H1: errors thrown inside the detached agent run land in runQueue's
      // catch, which calls this via the per-item capture context. Emit a
      // structured SSE error frame and finish so the client sees the failure
      // immediately instead of waiting for the hard cap.
      const onError = (err) => {
        if (settled) return;
        streamError = err || new Error("agent run failed");
        console.warn(
          `[quick-call/stream] agent run failed: ${streamError.message || streamError}`,
        );
        send(
          "error",
          buildStreamError("agent_failed", {
            detail: streamError.message,
          }),
        );
        finish();
      };
      const onClientClose = () => finish();
      req.on("close", onClientClose);

      // CRIT-1: pass the capture context DOWN to the queue item rather than
      // wrapping dispatchLoopEvent in runWithReplyCapture here. The real agent
      // run is detached in runQueue's IIFE; binding capture to the shared
      // dispatch async context let a second item drained under the same IIFE
      // inherit THIS request's capture and bleed its sends into this stream.
      dispatchLoopEvent(envelope, {
        enqueueMessage,
        sendMessage,
        sendTapback,
        typingSeconds: 0,
        capture: {
          contact: identity.phoneNumber,
          onMessage,
          onError,
          onProgress,
        },
      })
        .then(() => {
          // Dispatch only enqueues; the agent run continues asynchronously.
          // Mark dispatch resolved and (re)arm the no-output timer so a run
          // that produces nothing settles fast instead of at the hard cap.
          dispatchDone = true;
          if (!full && !streamError && !settled) armNoOutputTimer();
        })
        .catch((err) => {
          // Fallback for synchronous / dispatch-time errors (before the agent
          // run is even enqueued). Run-time errors come back through onError.
          onError(err);
        });

      await done;
      req.off("close", onClientClose);
      console.log(
        `[quick-call/stream] settled class=${turnClass} fullLen=${full.length} hadError=${!!streamError} dispatchDone=${dispatchDone}`,
      );
      if (full) {
        send("done", { answer: full });
        send("complete", {});
      } else if (!streamError) {
        // streamError already emitted its own error frame in onError.
        send("error", buildStreamError("empty_response"));
      }
      if (!res.writableEnded) res.end();
      return;
    }

    // ── Admin: post as a user (dashboard's "Tell Medha") ───────
    // POST /admin/say-as-user with { from, group_id?, text } and
    // X-Admin-Token. Synthesizes a fake Loop webhook envelope and
    // routes it through dispatchLoopEvent so the agent processes it
    // exactly as if the user had texted Medha themselves. This is
    // the bidirectional symmetry from decision 23.
    if (req.method === "POST" && req.url === "/admin/say-as-user") {
      if (!checkAdminAuth(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      let payload = {};
      try {
        payload = (await readJsonBody(req)) || {};
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || "invalid_json" }));
        return;
      }
      const from = String(payload.from || "").trim();
      const text = String(payload.text || "").trim();
      const groupId = payload.group_id || null;
      if (!from || !text) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "from and text are required" }));
        return;
      }
      try {
        // Synthesize a Loop-shaped webhook. Use MEDHA_EXPERT_SENDER_ID
        // so resolveTenantStrict resolves to the Medha-expert tenant
        // (no spoofing other tenants).
        const synthetic = {
          event: "message_inbound",
          contact: from,
          text,
          group_id: groupId,
          sender: process.env.MEDHA_EXPERT_SENDER_ID,
          message_id: `dash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          source: "dashboard",
        };
        // Mirror to ring buffer so /debug/recent-webhooks shows it.
        recordWebhook(synthetic);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, message_id: synthetic.message_id }));
        // Fire-and-forget dispatch — don't make the caller wait on the
        // full agent loop (which can take 5+ seconds).
        dispatchLoopEvent(synthetic, {
          enqueueMessage,
          sendMessage,
          sendTapback,
          typingSeconds: TYPING_SECONDS,
        }).catch((err) =>
          console.warn(`[admin/say-as-user] dispatch failed: ${err.message}`),
        );
        return;
      } catch (err) {
        console.error(`[admin/say-as-user] failed: ${err.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }

    // ── Admin: flip a person's opt-in status in a group (flaw #10) ─
    // POST /admin/opt-in with { group_id, handle, status } and
    // X-Admin-Token. Status must be one of: pending | opted_in |
    // opted_out | stopped. Useful for tests, support, and breaking
    // people out of stuck handshake states.
    if (req.method === "POST" && req.url === "/admin/opt-in") {
      if (!checkAdminAuth(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      let payload = {};
      try {
        payload = (await readJsonBody(req)) || {};
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || "invalid_json" }));
        return;
      }
      const groupId = String(payload.group_id || "").trim();
      const handle = String(payload.handle || "").trim();
      const status = String(payload.status || "").trim();
      const ALLOWED = new Set(["pending", "opted_in", "opted_out", "stopped"]);
      if (!groupId || !handle || !ALLOWED.has(status)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error:
              "group_id, handle, and status (one of pending|opted_in|opted_out|stopped) are required",
          }),
        );
        return;
      }
      try {
        const { loadGroupMemory, saveGroupMemory, setOptInStatus } =
          await import("./group-memory.js");
        const expertSenderId = process.env.MEDHA_EXPERT_SENDER_ID;
        const tenant = expertSenderId
          ? await resolveTenant(expertSenderId).catch(() => null)
          : null;
        const groupMem = await loadGroupMemory(groupId, tenant);
        const before = groupMem?.optInStatus?.[handle] || null;
        setOptInStatus(groupMem, handle, status);
        await saveGroupMemory(groupId, groupMem, tenant);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            group_id: groupId,
            handle,
            before,
            after: status,
          }),
        );
        return;
      } catch (err) {
        console.error(`[admin/opt-in] failed: ${err.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }

    // ── Slack events webhook ──────────────────────────────────
    // POST /slack/events lands DM and @mention events from the Medha
    // Slack app. Signature verification (HMAC SHA256 over the raw body
    // with SLACK_SIGNING_SECRET) requires reading the body as bytes
    // first, so we use the same raw-body pattern as /webhook. The
    // handler itself does dedup + ack <3s + dispatch into agent.js's
    // enqueueMessage. See lib/transports/slack/index.js.
    if (req.method === "POST" && req.url === "/slack/events") {
      let body = "";
      let bodyBytes = 0;
      let aborted = false;
      req.on("data", (chunk) => {
        bodyBytes += chunk.length;
        if (bodyBytes > MAX_BODY_BYTES) {
          aborted = true;
          res.writeHead(413);
          res.end(
            JSON.stringify({
              error: "Payload too large",
              code: "PAYLOAD_TOO_LARGE",
            }),
          );
          req.destroy();
        } else {
          body += chunk.toString();
        }
      });
      req.on("end", async () => {
        if (aborted) return;
        try {
          await slackEventsHandler(req, res, body, { enqueueMessage });
        } catch (err) {
          console.error(`[slack] handler crashed: ${err.message}`);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "internal-error" }));
          }
        }
      });
      return;
    }

    // ── Slack interactivity webhook ───────────────────────────
    // Block Kit / shortcut / view_submission payloads land here. Not in
    // scope for the initial transport (no interactive UI shipped yet),
    // but the route stub exists so Slack does not surface configuration
    // errors when the app is installed with the interactivity URL set.
    // Future: parse `payload` form field, verify signature, dispatch.
    if (req.method === "POST" && req.url === "/slack/interactivity") {
      // Drain the body so the connection closes cleanly.
      req.on("data", () => {});
      req.on("end", () => {
        if (!res.headersSent) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ ok: true, note: "interactivity-not-implemented" }),
          );
        }
      });
      return;
    }

    // ── Loop Message webhook ───────────────────────────────────
    // Signature verification requires the raw request body, so we read
    // the body BEFORE auth-checking. The body cap protects us from a
    // memory exhaustion attack on this read.
    if (req.method === "POST" && req.url.startsWith("/webhook")) {
      let body = "";
      let bodyBytes = 0;
      let aborted = false;
      req.on("data", (chunk) => {
        bodyBytes += chunk.length;
        if (bodyBytes > MAX_BODY_BYTES) {
          aborted = true;
          res.writeHead(413);
          res.end(
            JSON.stringify({
              error: "Payload too large",
              code: "PAYLOAD_TOO_LARGE",
            }),
          );
          req.destroy();
        } else {
          body += chunk.toString();
        }
      });
      req.on("end", async () => {
        if (aborted) return;

        // Capture every inbound (auth-pass OR auth-fail) into the ring
        // buffer FIRST so /debug/recent-webhooks can observe rejected
        // payloads. Without this we have zero visibility into what Loop
        // is sending when the secret config is wrong. The buffer is
        // already admin-gated, so this doesn't widen the data surface.
        // Parsing errors are tolerated — we just skip the recording.
        let parsedForRecord = null;
        try {
          parsedForRecord = JSON.parse(body);
          recordWebhook(parsedForRecord);
          // Fire-and-forget archive to GCS (Togari parity). The archiver
          // silently no-ops if the bucket doesn't exist yet OR if GCS
          // creds aren't configured — never blocks the reply path.
          import("./pdw/raw-archive.js")
            .then(({ archiveRawWebhook }) => archiveRawWebhook(parsedForRecord))
            .catch(() => {});
        } catch {}

        if (!checkWebhookAuth(req, body)) {
          // One-time-per-request log: dump the auth-relevant headers so
          // operators can see what Loop is actually sending (Loop-
          // Signature? x-webhook-secret? Bearer?) and configure the
          // matching secret. Without this, debugging auth-config drift
          // requires Railway log spelunking.
          const h = req.headers || {};
          console.warn(
            `[webhook-auth] reject POST /webhook: no-auth-configured-prod` +
              ` | loop-signature=${h["loop-signature"] || h["x-loop-signature"] || "—"}` +
              ` | x-webhook-secret=${h["x-webhook-secret"] ? "present" : "—"}` +
              ` | authorization=${h["authorization"] ? "present" : "—"}` +
              ` | user-agent=${(h["user-agent"] || "").slice(0, 60)}`,
          );
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }),
          );
          return;
        }
        // ACK fast so Loop doesn't retry while we're still processing.
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true }));
        try {
          const payload = parsedForRecord ?? JSON.parse(body);
          const validationError = validateLoopPayload(payload);
          if (validationError) {
            console.warn(`[webhook] Invalid Loop payload: ${validationError}`);
            return;
          }

          // Idempotency: Loop retries on non-2xx or timeout. If we've
          // already seen this exact event (by message_id or composite
          // hash), skip it so Amber doesn't reply twice.
          const dedupeKey = inboundDedupeKey(payload);
          if (dedupeKey && !markSeen(dedupeKey)) {
            console.log(`[webhook] duplicate event dropped: ${dedupeKey}`);
            return;
          }

          await dispatchLoopEvent(payload, {
            enqueueMessage,
            sendMessage,
            sendTapback,
            typingSeconds: TYPING_SECONDS,
          });
        } catch (err) {
          console.error("Webhook parse error:", err.message);
        }
      });
      return;
    }

    // ── Debug endpoints ────────────────────────────────────────
    // /debug/* exposes raw inbound payloads (which include sender
    // phones, plain-text content, etc). Gated behind ADMIN_TOKEN —
    // distinct from WEBHOOK_SECRET so a webhook secret leak doesn't
    // open the debug surface. In production with no ADMIN_TOKEN set,
    // checkAdminAuth returns false and the endpoint refuses entirely.
    if (req.method === "GET" && req.url.startsWith("/debug/")) {
      if (!checkAdminAuth(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }),
        );
        return;
      }
      if (req.url.startsWith("/debug/recent-webhooks")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(
            { count: RECENT_WEBHOOKS.length, items: RECENT_WEBHOOKS },
            null,
            2,
          ),
        );
        return;
      }
      if (req.url.startsWith("/debug/breakers")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ breakers: allBreakerStatus() }, null, 2));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Unknown debug endpoint", code: "NOT_FOUND" }),
      );
      return;
    }

    if (req.url === "/status" || req.url === "/health") {
      const state = getState();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            status: "running",
            ...state,
            uptime: process.uptime(),
            tiwari: {
              context: !!PERPLEXITY_API_KEY,
              search: !!EXA_API_KEY,
            },
            cache: {
              contacts: contactMemoryCache.size,
              conversations: conversationMemoryCache.size,
            },
            transport: "loop",
            platforms: getPlatformStatus(),
          },
          null,
          2,
        ),
      );
    } else {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Amber Agent Running\n");
    }
  });

  server.listen(PORT, () => {
    console.log(`amber-agent listening on port ${PORT}`);
  });

  return server;
}

/**
 * Dispatch a Loop Message webhook payload to the right handler.
 * Separated from the HTTP plumbing so each event handler is easy to
 * read, extend, and unit-test.
 *
 * Loop event types (as of 2026-Q2):
 *   message_inbound       - Someone sent a message / voice note to our number
 *   message_reaction      - Someone tapped back on one of our messages
 *   message_delivered     - A message we sent was delivered (blue ticks)
 *   message_failed        - A message we sent failed (carries error_code)
 *   message_scheduled     - A scheduled send was accepted by Loop
 *   inbound_call          - Someone FaceTimed / called our number
 *   opt-in                - User opted into messaging via a Loop opt-in URL
 *   sender_name_updated   - Our sender display name changed
 */
async function dispatchLoopEvent(payload, ctx) {
  const event = payload.event || "unknown";

  switch (event) {
    case "message_inbound":
      return handleInbound(payload, ctx);
    case "message_reaction":
      return handleReaction(payload, ctx);
    case "message_delivered":
      return handleDelivered(payload);
    case "message_failed":
      return handleFailed(payload, ctx);
    case "message_scheduled":
      return handleScheduled(payload);
    case "inbound_call":
      return handleInboundCall(payload, ctx);
    case "opt-in":
    case "opt_in":
      return handleOptIn(payload);
    case "sender_name_updated":
      return handleSenderNameUpdated(payload);
    default:
      console.log(`[webhook] unhandled event: ${event}`);
      return null;
  }
}

// ── Event handlers ─────────────────────────────────────────────────────

async function handleReaction(payload, { sendTapback }) {
  const from = payload.contact || payload.from || null;
  if (!from) return;
  const reaction = payload.reaction;
  const targetMsgId =
    payload.reacted_to_message_id ||
    payload.target_message_id ||
    payload.source_message_id ||
    payload.original_message_id ||
    payload.message_id ||
    null;
  if ((reaction === "love" || reaction === "like") && targetMsgId) {
    sendTapback(from, targetMsgId, "love").catch(() => {});
  }

  // Feedback loop: log the reaction if it targets Amber's recent outbound.
  // Works for both positive (love/like/laugh/emphasize) and negative
  // (dislike/question) tapbacks. Lazy-imported to avoid a cycle with agent.js.
  let groupIdForOptIn = null;
  let tenantForOptIn = null;
  try {
    const { captureReaction } = await import("./feedback-loop.js");
    const { resolveTenant } = await import("./tenant.js");
    const loopSenderUuid = payload.sender || payload.sender_name || null;
    const tenant = loopSenderUuid
      ? await resolveTenant(loopSenderUuid).catch(() => null)
      : null;
    tenantForOptIn = tenant;
    const rawGroup =
      payload.group_id || payload.chat_id || payload.group || null;
    const groupId =
      rawGroup && typeof rawGroup === "object"
        ? rawGroup.id || rawGroup.guid
        : rawGroup
          ? String(rawGroup)
          : null;
    groupIdForOptIn = groupId;
    const chatKey = groupId ? `group:${groupId}` : from;
    captureReaction({
      chatKey,
      from,
      text: null,
      tapbackType: reaction,
      replyToId: targetMsgId,
      tenant,
    }).catch(() => {});
  } catch (e) {
    console.warn("[feedback] reaction capture error:", e.message);
  }

  // flaw #2 — route tapback reactions through opt-in detection. When a
  // group member 👍's Medha's handshake, that's their opt-in. We persist
  // it to group memory so dm_each_in_group can DM them going forward.
  // Only fires for group reactions (DM reactions don't carry opt-in
  // semantics — those flip via STOP / YES text in the inbound path).
  if (groupIdForOptIn && reaction) {
    try {
      const { detectOptIn, recordOptIn } = await import("./bootstrapping.js");
      if (detectOptIn({ reactionType: reaction })) {
        const { loadGroupMemory, saveGroupMemory } =
          await import("./group-memory.js");
        const { normalizeHandle: normalize } = await import("./permissions.js");
        const groupMem = await loadGroupMemory(
          groupIdForOptIn,
          tenantForOptIn,
        ).catch(() => null);
        if (groupMem) {
          const handle = normalize(from);
          recordOptIn(groupMem, handle);
          await saveGroupMemory(groupIdForOptIn, groupMem, tenantForOptIn);
          console.log(
            `[opt-in] ${handle} opted in via tapback ${reaction} in ${groupIdForOptIn}`,
          );
        }
      }
    } catch (err) {
      console.warn(`[bootstrapping] reaction opt-in failed: ${err.message}`);
    }
  }
}

async function handleInbound(
  payload,
  { enqueueMessage, sendMessage, typingSeconds, capture = null },
) {
  // Audio detection. Loop's inbound audio webhooks land with `type: "audio"`
  // (NOT `message_type`) and put the audio file URL in `attachments[0]`.
  // The older `message_type` + `speech.text` shape never fires for us in
  // practice, but we keep it as a defensive fallback.
  const isAudioMessage =
    payload.type === "audio" ||
    payload.message_type === "audio" ||
    !!payload.speech?.text;
  const loopTranscript = payload.speech?.text || null;
  const audioUrl =
    isAudioMessage && Array.isArray(payload.attachments)
      ? payload.attachments.find(
          (a) => typeof a === "string" && /^https?:\/\//i.test(a),
        ) || null
      : null;
  // Tab 8: non-audio attachments (PDFs, images, docs) flow through OCR
  // in agent.js. Filter the audio URL out so we don't double-process it.
  const nonAudioAttachments = Array.isArray(payload.attachments)
    ? payload.attachments.filter(
        (a) =>
          typeof a === "string" && /^https?:\/\//i.test(a) && a !== audioUrl,
      )
    : [];

  // If it's audio and we have a URL, transcribe it ourselves via
  // ElevenLabs Scribe — don't depend on Loop, don't lose nuance like
  // language or speaker that the model can use. Only one network round-
  // trip on the inbound path; agent processing waits on it because the
  // text it produces IS the message content.
  let ourTranscript = null;
  if (audioUrl) {
    try {
      const { executeTranscribeTool } = await import("./tools/transcribe.js");
      const result = await executeTranscribeTool(
        "transcribe_audio",
        { url: audioUrl },
        // No tenant scope — transcription uses the org-level
        // ELEVENLABS_API_KEY env (same key as outbound voice notes).
        { tenant: null },
      );
      if (result?.text) {
        ourTranscript = result.text.trim();
        console.log(
          `[transcribe] ${result.duration_seconds || "?"}s ${result.language || "?"} → ${ourTranscript.slice(0, 80)}`,
        );
      } else if (result?.error) {
        console.warn(`[transcribe] failed: ${result.error}`);
      }
    } catch (err) {
      console.warn(`[transcribe] threw: ${err.message}`);
    }
  }

  // Prefer our own transcript over Loop's; fall back through to plain text.
  const transcribedText = ourTranscript || loopTranscript;
  const effectiveText = payload.text || transcribedText || null;
  const from = payload.contact || payload.from || null;

  // Resolve the tenant from Loop's `sender` UUID up-front, going
  // through the strict resolver that rejects any tenant-identifying
  // claim in the payload that doesn't match amber-id. Every identity
  // check below — self-echo filter, voice-note apology — scopes to
  // the resolved tenant's sender phone. If amber-id can't route the
  // sender (or claims mismatch), we drop the message rather than
  // answer under the wrong identity.
  const loopSenderUuid = payload.sender || payload.sender_name || null;
  const tenant = await resolveTenantStrict(payload);
  if (!tenant) {
    console.warn(
      `[webhook] inbound for unknown/mismatched sender=${loopSenderUuid} from=${from} — dropping`,
    );
    return;
  }
  const tenantPhoneNorm = tenant.loopSenderPhone
    ? normalizeHandle(tenant.loopSenderPhone)
    : null;

  const rawGroup = payload.group_id || payload.chat_id || payload.group || null;
  const groupIsObject = rawGroup !== null && typeof rawGroup === "object";
  const groupId = rawGroup
    ? groupIsObject
      ? rawGroup.id || rawGroup.guid
      : String(rawGroup)
    : null;
  const isGroupChat = groupId !== null;

  // Failed audio transcription — apologize in DMs only, and only if the
  // sender isn't our own agent echoing back.
  if (
    !effectiveText &&
    isAudioMessage &&
    from &&
    !isGroupChat &&
    (!tenantPhoneNorm || normalizeHandle(from) !== tenantPhoneNorm)
  ) {
    await sendMessage(
      from,
      "I couldn't transcribe that voice message. Could you send it again or type it?",
      { tenant, auditOrigin: "webhook", webhookContact: from },
    ).catch(() => {});
    return;
  }

  // Tab 8: allow attachment-only messages through. If there's no text but
  // the user sent a PDF / image, agent.js will OCR it and prepend the
  // extracted content to the model's view of the turn.
  if ((!effectiveText && nonAudioAttachments.length === 0) || !from) return;
  if (tenantPhoneNorm && normalizeHandle(from) === tenantPhoneNorm) {
    return; // ignore our own messages echoing back
  }

  // UX: show the typing indicator + mark read immediately. This fires
  // before the AI pipeline, so the recipient sees the bubble in <1s.
  // Loop doesn't support typing/read in group chats (returns 400 code
  // 100) — pass isGroup so showTyping no-ops cleanly without spamming
  // warning logs on every group inbound.
  //
  // L1: skip the typing call entirely when there's nothing to show.
  // quick-call (in-app stream + Shortcut) passes typingSeconds=0 and a
  // synthetic message_id that Loop can't thread a typing indicator to, so
  // the POST is wasted (showTyping would clamp 0 -> 1 and ping Loop anyway).
  if (
    payload.message_id &&
    typingSeconds !== 0 &&
    payload.source !== "quick-call"
  ) {
    showTyping({
      messageId: payload.message_id,
      seconds: typingSeconds,
      read: true,
      isGroup: isGroupChat,
    }).catch(() => {});
  }

  // Tab 8: attachment-only turns (no caption) still flow through; agent.js
  // detects the marker and OCRs before prompting the model.
  const baseText = effectiveText || "[attachment-only message]";
  const text = isAudioMessage ? `[voice-in] ${baseText}` : baseText;
  const rawGroupName =
    payload.group_name || (groupIsObject ? rawGroup.name : null) || null;
  const participants =
    payload.participants ||
    (groupIsObject ? rawGroup.participants : null) ||
    [];

  // Flaw #33: fire-and-forget HTTP POST to medha-id /v1/embeddings/inbound.
  // medha-id now owns the OpenAI call + the BQ write — server.js just
  // hands over the envelope. tenant.privyDid is required by the schema.
  if (effectiveText && tenant?.privyDid) {
    import("./embeddings.js")
      .then(({ recordInbound, isAvailable }) => {
        if (!isAvailable()) return;
        return recordInbound({
          messageId: payload.message_id || `${Date.now()}-${from}`,
          tenantDid: tenant.privyDid,
          contact: from,
          groupId,
          channel: payload.channel || null,
          messageType: isAudioMessage ? "audio" : "text",
          text: effectiveText,
          audioUrl,
          language: ourTranscript ? "auto" : null,
          rawPayload: payload,
        });
      })
      .catch((err) =>
        console.warn(`[embeddings] inbound write skipped: ${err.message}`),
      );

    // Flaw #31: extract facts about people OTHER than the sender from
    // every inbound message. Fire-and-forget; the heuristic gate inside
    // extractAndStoreFacts drops most short messages without an LLM call.
    import("./fact-extractor.js")
      .then(({ extractAndStoreFacts }) =>
        extractAndStoreFacts({
          text: effectiveText,
          tenantDid: tenant.privyDid,
          sourceContact: from,
          sourceMessageId: payload.message_id || null,
        }),
      )
      .catch((err) =>
        console.warn(`[fact-extractor] inbound skipped: ${err.message}`),
      );
  }

  // Enqueue in the order handleWebhookMessage expects:
  //   (from, text, messageId, groupId, groupName, participants, replyToId, loopSenderId, attachments)
  //
  // replyToId is Loop's `reply_to_id` (inline reply pointer). Loop's
  // `thread_id` is a conversation-level identifier and is intentionally
  // not used here — the previous code conflated the two. loopSenderId
  // is Loop's `sender` UUID, which drives per-tenant resolution so
  // Camber (Caleb) and Samber (Sagar) route to the right tenant.
  // attachments is Tab 8's non-audio Loop attachment URLs (PDFs, images,
  // docs); agent.js OCRs them and inlines the text before the model sees
  // the turn.
  // CRIT-1: pass the per-request reply-capture context (if any) down as an
  // out-of-band opt so runQueue can bind it to THIS specific queue item.
  // For every normal iMessage / Slack inbound `capture` is null and behavior
  // is unchanged.
  enqueueMessage(
    [
      from,
      text,
      payload.message_id,
      groupId,
      rawGroupName,
      participants,
      payload.reply_to_id || null,
      payload.sender || payload.sender_name || null,
      nonAudioAttachments,
    ],
    capture ? { capture } : {},
  );
}

async function handleDelivered(payload) {
  // Minimal: just log. Useful for diagnosing delivery regressions and
  // for future: updating message status in amber-id for lifecycle UI.
  const id = payload.message_id || payload.id || "?";
  console.log(
    `[loop-delivered] message_id=${id} contact=${payload.contact || "?"}`,
  );
}

async function handleFailed(payload, { sendMessage }) {
  const id = payload.message_id || payload.id || "?";
  const code = payload.error_code || payload.code || "unknown";
  const reason = payload.error_message || payload.reason || "";
  const contact = payload.contact || payload.recipient || "?";
  console.warn(
    `[loop-failed] message_id=${id} contact=${contact} code=${code} reason=${reason}`,
  );

  // Codes worth alerting the tenant owner about. Most failures are
  // transient (green-bubble fallback, network) and not worth a ping.
  const ALERT_CODES = new Set([
    "recipient_not_imessage",
    "invalid_recipient",
    "blocked",
    "rate_limited",
    "unauthorized",
  ]);
  if (!ALERT_CODES.has(String(code))) return;

  // Resolve the tenant whose send failed (from the payload's sender UUID)
  // so we alert the right owner's phone via the right sender.
  const loopSenderUuid = payload.sender || payload.sender_name || null;
  const tenant = await resolveTenant(loopSenderUuid);
  if (!tenant || !tenant.phoneNumber) {
    console.warn(
      `[loop-failed] no tenant resolved for sender=${loopSenderUuid}; skipping owner alert`,
    );
    return;
  }
  const alert = `⚠️ Loop delivery failed to ${contact} (${code}). Message id: ${id}.`;
  sendMessage(tenant.phoneNumber, alert, {
    tenant,
    auditOrigin: "webhook",
  }).catch(() => {});
}

async function handleScheduled(payload) {
  const id = payload.message_id || payload.id || "?";
  const when = payload.scheduled_at || payload.send_at || "?";
  console.log(`[loop-scheduled] message_id=${id} send_at=${when}`);
}

async function handleInboundCall(payload, { sendMessage }) {
  // Loop sends an event when someone FaceTimes our number. Amber can't
  // answer a FaceTime video call, but we can politely text back so the
  // caller knows they should try voice via amber-phone-call or iMessage.
  const from = payload.contact || payload.from || payload.caller || null;
  if (!from) return;
  const kind = payload.call_type || "call";
  console.log(`[loop-inbound-call] from=${from} type=${kind}`);

  // Transport requires `opts.tenant.loopSenderId` on every send. Resolve
  // from the payload's sender UUID before replying; if we can't route
  // the call to a known tenant, drop silently rather than throwing.
  const loopSenderUuid = payload.sender || payload.sender_name || null;
  const tenant = await resolveTenant(loopSenderUuid).catch(() => null);
  if (!tenant) {
    console.warn(
      `[loop-inbound-call] no tenant resolved for sender=${loopSenderUuid}; not replying`,
    );
    return;
  }
  const reply =
    "Hey — I can't pick up FaceTime directly, but I'm right here on iMessage. " +
    "What's up?";
  sendMessage(from, reply, {
    tenant,
    auditOrigin: "webhook",
    webhookContact: from,
  }).catch(() => {});
}

async function handleOptIn(payload) {
  const handle = payload.contact || payload.from || payload.recipient || "?";
  const params = payload.parameters || payload.params || null;
  console.log(
    `[loop-opt-in] contact=${handle} params=${JSON.stringify(params || {}).slice(0, 200)}`,
  );
  // Future: forward to amber-id so onboarding flows (Privy linking,
  // health-dim seed, etc.) can be triggered off this event.
}

async function handleSenderNameUpdated(payload) {
  const senderId = payload.sender_id || payload.sender || "?";
  const name = payload.sender_name || payload.name || "?";
  console.log(`[loop-sender-updated] sender_id=${senderId} name=${name}`);
}
