import { registerContactPreviewRoutes } from './routes/contact-preview.js';
import { registerAmberCardRoutes } from './routes/amber-card.js';
import { registerOnboardingContextRoutes } from './routes/onboarding-context.js';
import { registerHealthSummaryRoutes } from './routes/health-summary.js';
import { registerCaptureRoutes } from "./routes/capture.js";
import { registerCommunityRoutes } from "./routes/community.js";
import { registerPeopleRankRoutes } from "./routes/people-rank.js";
/**
 * amber-id: Identity and tenant resolution service for the Amber platform.
 * Cloud SQL is the only data store. No Firestore, no Privy, no external vector
 * service: a request reads and writes the amber schema and nothing else.
 *
 * Provides:
 * - Tenant resolution by sender ID (for amber-agent webhooks)
 * - Tenant profile via session token (for iOS/web apps)
 * - Number pool management (assign iMessage sender numbers)
 * - Auth verification and onboarding
 */

// CREDENTIALS FIRST, BEFORE ANY MODULE OPENS A CONNECTION. Railway carries the
// service account as JSON text; every Google library wants a file path. This
// used to happen inside Firestore's boot and vanished with it — see
// lib/gcp-credentials.js for the full account. Reported here so a misconfigured
// deploy says so on its first log line instead of 401ing every request forever.
import { reportGcpCredentials } from "./lib/gcp-credentials.js";
reportGcpCredentials();

const { reportPeopleRank } = await import("./enrichment/togari-search-rank.js");
reportPeopleRank();

import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { registerTenantRoutes } from "./routes/tenants.js";
import { registerNumberRoutes } from "./routes/numbers.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerOnboardingRoutes } from "./routes/onboarding.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerUserApiKeyRoutes } from "./routes/api-keys.js";
import { registerMemoPlanRoutes } from "./routes/memo-plans.js";
import { registerDiscoverySearchRoutes } from "./routes/discovery-search.js";
import { registerClaySearchRoutes } from "./routes/clay-search.js";
import { registerClayPushRoutes } from "./routes/clay-push.js";
import { registerContactEnrichmentRoutes } from "./routes/contacts-enrich.js";
import { registerPushTokenRoutes } from "./routes/push-tokens.js";
import { registerPrivacyRoutes } from "./routes/privacy.js";
import { registerInternalRoutes } from "./routes/internal.js";
import { registerBioRoutes } from "./routes/bio.js";
import { registerDataRoutes } from "./routes/data.js";
import { registerPhoneAuthRoutes } from "./routes/phone-auth.js";
import { registerAuthSessionRoutes } from "./routes/auth-sessions.js";
import { registerNoteMediaRoutes } from "./routes/note-media.js";
import { registerDmRoutes } from "./routes/dms.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerConnectLinkRoutes } from "./routes/connect-link.js";
import { registerLegalRoutes } from "./routes/legal.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerPhotonWebhookRoutes } from "./routes/photon-webhook.js";
import { registerSecretsRoutes } from "./routes/secrets.js";
import { registerDimensionsRoutes } from "./routes/dimensions.js";
import { registerNetworkIntelligenceRoutes } from "./routes/network-intelligence.js";
import { registerOtpRoutes } from "./routes/otp.js";
import { registerIdentitySummaryRoutes } from "./routes/identity-summary.js";
import { registerCalendarOpportunitiesRoutes } from "./routes/calendar-opportunities.js";
import { registerEventsRoutes } from "./routes/events.js";
import { registerPersonalLifeRoutes } from "./routes/personal-life.js";
import { registerContentSeedsRoutes } from "./routes/content-seeds.js";
import { registerPipelinesRoutes } from "./routes/pipelines.js";
import { registerRemindersRoutes } from "./routes/reminders.js";
import { registerRemindersParseRoutes } from "./routes/reminders-parse.js";
import { registerNotificationSettingsRoutes } from "./routes/notification-settings.js";
import { registerImessageLinkRoutes } from "./routes/imessage-link.js";
import { enforceSchemaFreshness } from "./db/schema-guard.js";
import { registerSelfRemindersMeRoutes } from "./routes/self-reminders-me.js";
import { registerContactRankRoutes } from "./routes/contact-rank.js";
import { registerCircleFavoritesRoutes } from "./routes/circle-favorites.js";
import { registerSelfDimensionRoutes } from "./routes/self-dimensions.js";
import { registerAgendaRoutes } from "./routes/agenda.js";
import { registerScheduleRoutes } from "./routes/schedule.js";
import { registerPostSocialRoutes } from "./routes/post-social.js";
import { registerCalendarRoutes } from "./routes/calendars.js";
import { registerMailRoutes } from "./routes/mail.js";
import { registerContactImportRoutes } from "./routes/contact-import.js";
import { registerVoiceBioRoutes } from "./routes/voice-bio.js";
import { startReminderWorker } from "./jobs/reminder-worker.js";
import { startRollupWorker } from "./jobs/rollup-worker.js";
import { startGraphRefreshWorker } from "./jobs/graph-refresh-worker.js";
import { startReminderScheduler } from "./jobs/reminder-scheduler.js";
import { registerPartnershipsRoutes } from "./routes/partnerships.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerJournalRoutes } from "./routes/journal.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerCirclesRoutes } from "./routes/circles.js";
import { registerSharesRoutes } from "./routes/shares.js";
import { registerCohortRoutes } from "./routes/cohorts.js";
import { registerOrgRoutes } from "./routes/org.js";
import { registerOrgAuthRoutes } from "./routes/org-auth.js";
import { registerTenantScope } from "./db/tenant.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerOrgSsoRoutes } from "./routes/org-sso.js";
import { registerOrgWorkspaceRoutes } from "./routes/org-workspace.js";
import { registerOrgDriveRoutes } from "./routes/org-drive.js";
import { registerOrgKnowledgeRoutes } from "./routes/org-knowledge.js";
import { registerOrgMemoryRoutes } from "./routes/org-memory.js";
import { registerOrgCopilotRoutes } from "./routes/org-copilot.js";
import { registerOrgAskRoutes } from "./routes/org-ask.js";
import { registerOrgCircleRoutes } from "./routes/org-circles.js";
import { registerOrgCalendarRoutes } from "./routes/org-calendar.js";
import { registerOrgPageLinkRoutes } from "./routes/org-page-links.js";
import { registerOrgApiRoutes } from "./routes/org-api.js";
import { registerOrgApiSpecRoutes } from "./routes/org-api-spec.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";
import { registerLocationRoutes } from "./routes/locations.js";
import { registerNoteShareRoutes } from "./routes/note-shares.js";
import { registerExperienceRoutes } from "./routes/experiences.js";
import { registerContactNoteRoutes } from "./routes/contact-notes.js";
import { registerWebContactRoutes } from "./routes/contacts-web.js";
import { registerWallRoutes } from "./routes/wall.js";
import { registerFavoritesRoutes } from "./routes/favorites.js";
import { registerConnectRoutes } from "./routes/connections-social.js";
import { registerQuestionRoutes } from "./routes/questions.js";
import { registerPublicProfileRoutes } from "./routes/profiles-public.js";
import { registerIntroRoutes } from "./routes/intros.js";
import { registerMobileAuthRoutes } from "./routes/mobile-auth.js";
import {
  registerAppleAuthRoutes,
  registerGoogleAuthRoutes,
} from "./routes/social-auth.js";
import { registerVoiceNoteRoutes } from "./routes/voice-notes.js";
import { registerVoiceRoutes } from "./routes/voice.js";
import { registerMcp } from "./mcp/index.js";
import { registerSecretsV2 } from "./secrets-v2/index.js";
import { registerSlackLinks } from "./slack/index.js";
import { registerGoogleOauthRoutes } from "./routes/oauth-google.js";
import { registerLinkedinOauth } from "./routes/oauth-linkedin.js";
import { registerSlackOauthRoutes } from "./routes/oauth-slack.js";
import { registerNotionOauthRoutes } from "./routes/oauth-notion.js";
import { registerMicrosoftOauth } from "./routes/oauth-microsoft.js";
import { registerTwitterOauthRoutes } from "./routes/oauth-twitter.js";
import { registerGithubOauthRoutes } from "./routes/oauth-github.js";
import { registerRailwayOauthRoutes } from "./routes/oauth-railway.js";
import { registerConnectionsRoutes } from "./routes/connections.js";
import { registerOauthPlatformsRoute } from "./routes/oauth-platforms.js";
import { tenantIndex } from "./lib/auth-session.js";
import { closePool, query as sqlQuery } from "./db/sql.js";

// Dedup layer (Clay-callable matcher + Apple sync + Slack + magic-link).
// validateEnv hard-fails if the required dedup env vars are absent so the
// operator sees the problem at boot rather than at first request. The
// dynamic import below tolerates an absent dedup tree (pre-WS-0) and an
// absent tsx runtime — both degrade to a logged warning, not a crash.
let validateDedupEnv;
try {
  ({ validateEnv: validateDedupEnv } = await import("../dedup/lib/env.js"));
} catch (err) {
  // dedup/ tree not present (WS-0 not merged); skip env validation
  validateDedupEnv = null;
}
if (validateDedupEnv) validateDedupEnv();

const startedAt = Date.now();

// trustProxy: this service runs behind Railway's edge proxy, so the socket
// peer is the proxy, not the user. Without this, request.ip is the SAME value
// for every user on the planet -- which silently turned the rate limiter below
// into one shared global bucket (any single client could 429 the entire user
// base) and made every per-IP signal useless. Enabling it makes request.ip the
// left-most X-Forwarded-For entry, which is what routes/mobile-auth.js was
// already reconstructing by hand.
// trustProxy: 1, NOT `true`.
//
// `true` trusts the ENTIRE X-Forwarded-For chain, so request.ip became the left-most
// entry -- which any client can prepend at will. That made the address spoofable, and an
// IP-keyed rate limiter built on a spoofable address is not a rate limiter. A fixed hop
// count of 1 trusts exactly Railway's edge proxy (the one real hop in front of this
// service) and ignores anything the client injected before it.
//
// Without any trustProxy the opposite failure appears: request.ip is the proxy for every
// user on the planet, i.e. one shared global bucket. Both extremes are broken; the hop
// count is the correct middle.
const app = Fastify({ logger: { serializers: {
  // Callback query strings can carry credentials; headers/bodies stay out of logs.
  req: req => ({ method:req.method, url:String(req.url || '').split('?')[0] }),
}}, trustProxy: 1 });

// Tolerate an empty body on application/json requests. Several clients send
// Content-Type: application/json with no body, notably the web /connect page's
// disconnect button (DELETE /v1/oauth/google) and other bodyless DELETE/POST
// calls. Fastify's default JSON parser 400s those with "body cannot be empty
// when content type is set to application/json", which surfaced as a "could
// not disconnect" error in the app. Parse an empty/blank body as undefined so
// the route runs; non-empty bodies parse exactly as before.
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_req, body, done) => {
    if (body === "" || body == null) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      err.statusCode = 400;
      done(err, undefined);
    }
  },
);

/**
 * Origins allowed to call this API from a browser.
 *
 * ANCHORED. /localhost/ is a substring match, so it also allowed
 * https://localhost.attacker.com and any other host with "localhost" anywhere in
 * it. Auth here is a bearer token rather than a cookie, so the blast radius was
 * small, but an origin allowlist that matches hosts nobody owns is not an
 * allowlist. Dev origins are localhost/127.0.0.1 with an optional port only.
 *
 * THE WEBSITE'S ORIGIN COMES FROM THE ENVIRONMENT, not from this file. The
 * Amber site is not on railway.app, so signing in from it needs its origin
 * allowed -- and an origin allowlist is a security boundary, which is the last
 * thing that should be guessed at in a commit. AMBER_WEB_ORIGINS is a
 * comma-separated list of EXACT origins (scheme, host, optional port; no
 * wildcards, no trailing slash). Unset, nothing new is allowed and the API
 * behaves exactly as it did before this existed.
 */
const WEB_ORIGINS = String(process.env.AMBER_WEB_ORIGINS ?? "")
  .split(",")
  // INVISIBLE CHARACTERS ARE REAL AND THIS IS WHERE THEY LAND.
  //
  // This value is pasted into a web dashboard, and a paste carries whatever
  // the source had: a zero-width space, a BOM, a soft hyphen, a directional
  // mark. None of those are matched by \s, none are removed by trim(), and
  // none are visible in a log line -- so the allowlist prints exactly right
  // and then fails an exact string comparison against the browser's Origin
  // header, which is the most confusing failure this file can produce.
  //
  // Stripping them is a sanitization of configuration, not a loosening of the
  // check: what remains is still compared exactly.
  .map((o) =>
    o
      .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD\u200E\u200F]/g, "")
      .trim()
      .replace(/\/$/, ""),
  )
  .filter(Boolean)
  .filter((o) => {
    if (/^https?:\/\/[^/*?\s]+$/.test(o)) return true;
    console.error(`CORS_ORIGIN_REJECTED ${JSON.stringify(o)} -- must be an exact origin like https://amber.example`);
    return false;
  });

// QUOTED, so anything that survived sanitization is visible in the log rather
// than rendering as nothing.
if (WEB_ORIGINS.length) {
  console.log(`[cors] browser origins allowed: ${WEB_ORIGINS.map((o) => JSON.stringify(o)).join(", ")}`);
} else {
  console.warn("[cors] AMBER_WEB_ORIGINS is empty -- no browser origin can call this API.");
}

/**
 * A REFUSED ORIGIN HAS TO SHOW UP IN THE LOGS.
 *
 * The array form of this option is silent: a browser origin that is not on the
 * list gets a response with no Access-Control-Allow-Origin header, the browser
 * blocks it, and the API writes nothing at all. From the outside that is
 * indistinguishable from the API being down, and the one place somebody would
 * look for the cause is the one place that cannot show it.
 *
 * That cost real time. The site is served from https://www.amberintelligence.ai
 * and the allowlist had been set to the apex without the www, which CORS
 * treats as a completely different origin. Nothing in the logs said so.
 *
 * Same matching as before, plus a line naming the origin that was turned away.
 */
const ALLOWED_PATTERNS = [
  /\.railway\.app$/,
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

const originAllowed = (origin) =>
  ALLOWED_PATTERNS.some((re) => re.test(origin)) || WEB_ORIGINS.includes(origin);

await app.register(cors, {
  origin(origin, cb) {
    // NO ORIGIN HEADER IS NOT A BROWSER. The iOS app, curl and every
    // server-to-server caller send none, and they must keep working -- this is
    // the behavior the array form had, and losing it would break the app.
    if (!origin) return cb(null, true);
    if (originAllowed(origin)) return cb(null, true);
    console.warn(
      `CORS_ORIGIN_REFUSED browser sent ${JSON.stringify(origin)}; ` +
        `allowed: ${WEB_ORIGINS.length ? WEB_ORIGINS.map((o) => JSON.stringify(o)).join(", ") : "(empty)"}. ` +
        `Both sides are quoted so an invisible character shows up; origins match EXACTLY, ` +
        `so www and the apex are different origins.`,
    );
    return cb(null, false);
  },
});

// Rate limiting is keyed per IDENTITY where we have one, falling back to IP.
// Keying purely on IP is wrong for a mobile app: carrier-grade NAT puts
// thousands of real users behind one address, so an IP-only bucket punishes
// bystanders while barely inconveniencing an attacker (who can rotate IPs).
// Per-route overrides (see routes/auth-sessions.js) still apply on top.
/*
 * FILE UPLOADS, FOR ONE ROUTE.
 *
 * An AI export is the only thing anybody uploads here and it is large: a
 * couple of years of ChatGPT history runs to tens of megabytes zipped. The
 * cap is set at the parser's own limit rather than lower, so a file that
 * would be rejected is rejected for a stated reason rather than by a
 * truncated stream that looks like a corrupt archive.
 */
await app.register(multipart, {
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
});

await app.register(rateLimit, {
  // Raised from 100 now that the key is purely the IP and can no longer be rotated.
  // A shared carrier-NAT address carries many real users, and 100/min across all of them
  // would 429 legitimate traffic; 600/min is still far below what a single abusive client
  // needs and the per-route limits are what actually guard the sensitive endpoints.
  max: 600,
  timeWindow: "1 minute",
  // THE KEY IS THE IP, AND ONLY THE IP. Nothing from a header goes into it.
  //
  // This used to derive the bucket from `x-api-key` or `Authorization`, which made the
  // limiter opt-out rather than mandatory: the hook runs BEFORE any auth preHandler, so
  // those headers are entirely unverified, and
  //
  //     curl -H 'Authorization: Bearer <fresh random>' https://host/...
  //
  // minted a brand-new bucket on every request. That removed brute-force protection from
  // every rate-limited route in the service -- OTP, sign-in, the public /u/:username page
  // -- because the thing being counted was chosen by the caller.
  //
  // Compositing the token WITH the ip does not fix it either (I measured: 500 rotated
  // tokens from one address still produced 500 distinct buckets). Any attacker-controlled
  // component in a rate-limit key defeats the whole mechanism. The key has to be built
  // exclusively from something the caller cannot vary, which leaves the source address.
  //
  // The original comment's concern was real -- carrier-grade NAT puts many users behind
  // one address, so a tight per-IP bucket punishes bystanders -- so the answer is a
  // GENEROUS global ceiling that only a machine could reach, with the per-route limits
  // (auth-sessions, otp, clay push, /u/:username) doing the precise work. Those are now
  // unrotatable too, because they inherit this generator.
  keyGenerator: (req) => `ip:${req.ip || "unknown"}`,
});

/**
 * ONE error handler for the whole service.
 *
 * There was none, so Fastify's default took over and returned the raw internal message
 * to the client on any unhandled throw. That is not hypothetical: a `like` reaction
 * against a database whose CHECK constraint had not been widened yet returned
 *
 *   500 {"message":"new row for relation \"note_reactions\" violates check constraint
 *        \"note_reactions_kind_chk\""}
 *
 * to the phone -- leaking table names, column names and constraint names to anyone who
 * can trigger an error. Client errors (4xx) still pass through verbatim because their
 * messages are written for the user; 5xx gets logged in full server-side and answered
 * with something that says nothing about the schema.
 */
// ── THE ONE LINE THAT HAS TO SURVIVE THE LOG RENDERER ────────────────────────
//
// Twice in one day a real failure reached production as the word
// "unhandled_error" and nothing else, because the details were passed as an
// OBJECT beside the message and the platform's log view renders only the
// message. A 500 whose cause is not in its own text is a 500 nobody can fix:
// one of them cost an answer he had waited half a minute for, and the other sent
// me telling him to run migrations he had already run.
//
// So the interesting facts go IN THE STRING -- the route, the error's own name
// and code, its message, and the first frames of the stack. The structured
// object is still attached for anything that can read it; this is the copy that
// makes it out.
app.setErrorHandler((err, request, reply) => {
  const status = err.statusCode || 500;
  if (status >= 500) {
    const where = `${request.method} ${request.routeOptions?.url || request.url}`;
    const what =
      `${err?.name || "Error"} ${err?.code ? `${err.code} ` : ""}` +
      `${err?.constraint ? `[${err.constraint}] ` : ""}${err?.message || err}`;
    // Two frames: enough to name the file and the caller, short enough that the
    // line is still readable in a log stream.
    const stack = String(err?.stack || "")
      .split("\n")
      .slice(1, 3)
      .map((l) => l.trim())
      .join(" << ");
    request.log.error(
      { err, url: request.url, method: request.method },
      `unhandled_error ${where} — ${what}${stack ? ` @ ${stack}` : ""}`,
    );
    return reply.code(status).send({
      error: "internal_error",
      message: "Something went wrong on our end. Please try again.",
    });
  }
  // 4xx: validation messages and deliberate route errors are user-facing by design.
  return reply.code(status).send({
    error: err.code || "bad_request",
    message: err.message,
  });
});

// Audit logging: emit a structured log event for every admin (API-key-auth'd) request.
import { auditLog } from "./lib/audit.js";
import { instanceId } from "./lib/instance.js";
app.addHook("onResponse", async (request, reply) => {
  const hasApiKey = !!request.headers["x-api-key"];
  if (!hasApiKey) return; // only audit admin routes
  try {
    auditLog({
      route: request.routeOptions?.url || request.url,
      method: request.method,
      statusCode: reply.statusCode,
      result: reply.statusCode < 400 ? "success" : "failure",
      ip: request.ip,
      params: request.params,
      query: request.query,
      instanceId: request.instanceId || instanceId(),
      clientId: request.clientId || null,
    });
  } catch {
    // never let audit logging break the request path
  }
});

// Register routes
registerTenantRoutes(app);
registerNumberRoutes(app);
registerAuthRoutes(app);
registerOnboardingRoutes(app);
registerProfileRoutes(app);
registerUserApiKeyRoutes(app); // POST/GET/DELETE /v1/me/api-keys (JWT) — per-user personal keys + POST /v1/ingest/contacts (API key) — Clay/HTTP contact push into Cloud SQL via the app-sync upsert
registerClaySearchRoutes(app);
registerDiscoverySearchRoutes(app);
registerHealthSummaryRoutes(app);
registerMemoPlanRoutes(app);
registerClayPushRoutes(app); // GET/PUT/DELETE /v1/me/clay/destination + POST /v1/me/clay/push (JWT) — the mirror of the ingest route above: contacts OUT of Amber into the caller's own Clay table
registerContactEnrichmentRoutes(app); // GET /v1/me/contacts/summary + POST /v1/me/contacts/enrich + /:id/enrichment/resolve + GET|POST /v1/me/people/:id/enrich — enrichment HTTP surface (F6)
registerWebContactRoutes(app); // POST /v1/me/contacts/from-web — save a person found on the open web
registerChatRoutes(app); // POST /v1/chat — SSE chat; Haiku router → plain Sonnet chat | PeopleRank pipeline | both; persists to conversation_messages
registerJournalRoutes(app);
registerAmberCardRoutes(app);
registerContactPreviewRoutes(app);
registerOnboardingContextRoutes(app);
registerConversationRoutes(app); // GET /v1/conversations (+ /:id, DELETE /:id) — chat-history sidebar, scoped to caller
registerCirclesRoutes(app); // GET/POST /v1/me/circles, PATCH/DELETE /:id, GET/POST/DELETE /:id/members — owner-scoped contact grouping
registerSharesRoutes(app); // POST /v1/me/shares (+unshare), DELETE /:id, GET /for-item, GET /v1/me/shared-with-me — the privacy ledger
registerCohortRoutes(app); // GET /v1/me/cohorts, /:id/members, POST /refresh — audiences derived from contact email domains (the "everyone at stanford.edu" scope)
registerOrgRoutes(app); // POST /v1/org, /v1/org/me, members, groups, policy, invites — the enterprise fork's spine
registerTenantScope(app); // every org request runs inside a transaction that names its company, so the row-level policies have something to compare against
registerOrgSsoRoutes(app); // /v1/org/auth/google/* — continue with Google, for an account that already exists or has an open invitation
registerOrgWorkspaceRoutes(app); // /v1/org/connections + group calendars — where a team's work lives and when it happens
registerOrgMemoryRoutes(app); // /v1/org/memory/* — people, accounts, the append-only interaction ledger, going-cold nudges and per-person source consent
registerOrgCopilotRoutes(app); // /v1/org/copilot/* and /v1/oauth/microsoft/* — one-button admin consent for the Copilot history feed
registerOrgAskRoutes(app); // /v1/org/ask — one question, answered from the evidence this viewer may read
registerOrgCircleRoutes(app); // /v1/org/circles — a circle as a room: messages, work, files, links, people, calendar
registerOrgCalendarRoutes(app); // /v1/org/calendar — the calendars somebody connected, and what is on them
registerOrgPageLinkRoutes(app); // /v1/org/pages/:id/link and /p/:token — one page, one URL, anybody who has it
registerOrgApiRoutes(app);
registerOrgApiSpecRoutes(app); // GET /v1/api/openapi.json — the unauthenticated description Copilot Studio and friends import to build a connector // GET/POST/DELETE /v1/org/api-keys + /v1/org/connectors (admin session) and the key-authenticated public data API under /v1/api/*
registerAccountRoutes(app); // /v1/me/credentials, username, password — the only routes that change how somebody signs in
registerOrgDriveRoutes(app); // /v1/org/drive, files, tags — the company drive, with the text pulled out of what it holds
registerOrgKnowledgeRoutes(app); // /v1/org/knowledge, pages, files, feed, experts — what the company knows and who knows it
registerWorkspaceRoutes(app); // GET /v1/me/workspaces, link/start, link/verify, switch — the picker, and the only thing that crosses accounts
registerOrgAuthRoutes(app); // invite preview/accept + work-email sign-in — the four routes with no requireAuth on them
registerLocationRoutes(app); // GET/POST/DELETE /v1/me/locations, GET /v1/me/map (+/overlaps), GET /v1/places/search — high-level location sharing, coarsened in the database
registerNoteShareRoutes(app); // PUT/GET /v1/me/notes/:id/share, GET /v1/me/feed, GET /v1/me/circles/:id/feed — transcript-only voice-note sharing
// Audio, tapbacks and comments for those same shared notes.
registerNoteMediaRoutes(app);
registerDmRoutes(app); // GET/POST /v1/me/dms... — 1:1 direct messages, text + voice, reactions, search, export
// POST /v1/me/reports — report a user or a thread. Blocks in the same request
// unless told not to. The reporting half of App Store Guideline 1.2; the block
// half already lived in dms.js.
registerReportRoutes(app);
registerExperienceRoutes(app); // GET /v1/me/experiences, GET /v1/me/contacts/:id/experiences — read experiences for Memories + profile
registerContactNoteRoutes(app); // POST /v1/me/contacts/:id/note — capture a note to a contact server-side (feeds PeopleRank)
registerWallRoutes(app); // GET/POST /v1/me/wall, PATCH/DELETE /:id — owner-scoped Amber Wall posts
registerFavoritesRoutes(app); // GET/POST /v1/me/favorites, DELETE /:contactId — owner-scoped Amber Network favorites
registerConnectRoutes(app); // GET/POST/DELETE /v1/me/connect/* — social graph: search, requests, connections, feed
registerQuestionRoutes(app); // GET/POST/PATCH /v1/me/questions/* + /v1/me/answers/:id/visibility — Amber Q&A threads + answers (Phase 1)
registerPublicProfileRoutes(app); // GET /v1/users/:amberId/profile|network — cross-user reads, gated by the F4a privacy policy
registerIntroRoutes(app); // POST/GET /v1/me/intros/* — intro requests; /:id/contact is the ONLY cross-user contact-method release path (F4c)
registerMobileAuthRoutes(app); // POST /v1/auth/otp/request|verify — phone-OTP login via Photon, mints medha JWT
registerAppleAuthRoutes(app); // POST /v1/auth/apple|/link — Sign in with Apple, reconciled to a phone-verified user
registerGoogleAuthRoutes(app); // POST /v1/auth/google|/link — Sign in with Google, same two-step flow and the same phone root of identity
registerVoiceNoteRoutes(app); // POST /v1/me/contacts/:contactId/voice-note — Gemini transcribe+extract → notes/context, re-index
registerVoiceRoutes(app); // POST /v1/voice/dictate — audio → transcript (Groq/OpenAI/Gemini) → fact capture; /v1/voice/transcribe — audio → transcript only
registerPushTokenRoutes(app); // POST /v1/me/push-token — iOS onboarding step
registerPrivacyRoutes(app);
registerInternalRoutes(app);
registerBioRoutes(app); // GET /internal/bio/profile — scoped per-agent envelope (slice 1)
registerDataRoutes(app);

// Perplexity-for-People layer: cNFT identity, per-user Pinecone KB, Ask Amber.
// Additive only — does not touch existing auth / profile / onboarding routes.

// Medha dashboard surface (OTP auth + events + groups + persons +
// embeddings ingest + cross-group suppressions). Lives alongside the
// existing routes; the agent and the medha-trip-planning dashboard both
// talk to these endpoints.
registerPhoneAuthRoutes(app); // POST /v1/auth/start|issue-code|verify|verify-code-only
registerAuthSessionRoutes(app); // /v1/auth/refresh|invalidate|sessions — device sessions + refresh rotation

// Unauthenticated public read endpoints (e.g. /public/caleb-context for calebnewton.me).
registerPublicRoutes(app);
// The public /u/:username share page + the universal-link association file.
// Registered next to the other public surface because it is likewise
// unauthenticated by design -- it has to work for someone who does not have the
// app yet, which is the entire point of a share link.
registerConnectLinkRoutes(app);
// GET /legal, /legal/privacy, /legal/terms — the two documents the App Store
// listing links to and the app links to from Settings and the sign-in screen.
// Unauthenticated by necessity: a reviewer reads them before signing in.
registerLegalRoutes(app);
registerPhotonWebhookRoutes(app); // GET/POST /webhooks/photon/inbound — capture-only discovery stub (x-photon-key/?key= gated)
registerSecretsRoutes(app);
registerDimensionsRoutes(app);
registerNetworkIntelligenceRoutes(app);
registerOtpRoutes(app);
registerIdentitySummaryRoutes(app);
registerCalendarOpportunitiesRoutes(app);
registerEventsRoutes(app); // /v1/me/events* — Rave Master event memory wrappers
registerPersonalLifeRoutes(app); // /v1/personal/* — brand decisions, teammate pursuits, journal (tab-8)
registerContentSeedsRoutes(app); // /v1/content-seeds/* — raw newsletter capture + polish writeback (tab-13)
registerPipelinesRoutes(app); // /v1/pipelines/* — investor, event (Rytual), multi-thread relationships
registerRemindersRoutes(app); // /v1/me/reminders/* + /v1/internal/reminders/* — reminder CRUD + worker hooks (tab-16)
registerRemindersParseRoutes(app); // POST /v1/reminders/parse — voice transcript → reminders; persists a server row for EVERY parsed self-reminder (delivery channel decides the transport, not whether the row exists)
registerVoiceBioRoutes(app); // /v1/me/voice-bio* + GET /v1/profiles/:amberId/voice-bio — the profile clip, audible to the owner's connections
registerAgendaRoutes(app); // GET /v1/me/agenda — the events and timed reminders on a day
registerScheduleRoutes(app); // /v1/me/open-reminders/* + PATCH|DELETE /v1/me/events/:id — the untimed reminders at the top of Notes & Journal, and the two editors
registerPostSocialRoutes(app); // reactions + comments on a connection's feed post
registerCalendarRoutes(app); // connected calendars: list, sync into `events`, disconnect
registerMailRoutes(app); // /v1/me/mail — header-only Gmail sync + status
registerContactImportRoutes(app); // /v1/me/contacts/import-file — vCard + CSV
registerSelfDimensionRoutes(app); // GET /v1/me/dimensions — how well Amber knows the owner across the six dimensions
registerCircleFavoritesRoutes(app); // GET/POST/PUT/DELETE /v1/me/circle-favorites — the nine circles pinned to the profile, in the user's own order
registerSelfRemindersMeRoutes(app); // GET/POST/PATCH /v1/me/reminders/self — the app's own reminder list: list, manual entry, tick off
registerCommunityRoutes(app);
registerPeopleRankRoutes(app);
registerCaptureRoutes(app);
registerContactRankRoutes(app); // GET /v1/me/contacts/:id/rank — warmth, cadence and the six dimensions for ONE person (reads the rollup, computes nothing)
registerNotificationSettingsRoutes(app); // GET/PATCH /v1/me/notification-settings — per-user { channels: { apple, imessage } } for self-reminders (stored in users.profile_extra)
registerImessageLinkRoutes(app); // GET/POST/DELETE /v1/me/imessage-link — INBOUND consent: may a text from my number drive my account (users.imessage_linked_at/_phone). Not the same switch as notification-settings.channels.imessage, which is outbound delivery.
registerPartnershipsRoutes(app); // /v1/partnerships/* — long-form evolving partnership records with append-only history
registerMcp(app); // /mcp — MCP server exposing Medha tools (tab-2)
registerSecretsV2(app); // /v2/secrets/* — AES-256-GCM per-tenant secrets v2 (tab-5)
registerSlackLinks(app); // /v1/slack-links/* — Slack identity link Option C (tab-1)

// Phase 1 OAuth surface: per-user platform connections + workspace install.
// Each platform exposes /v1/oauth/<platform>/{init,callback,disconnect}; tokens
// land in the per-tenant secrets bag keyed by tenant DID. The connections route
// surfaces per-platform status for the medha-frontend /connect grid.
registerGoogleOauthRoutes(app); // /v1/oauth/google/*  (calendar + gmail + drive)
registerLinkedinOauth(app); // /v1/oauth/linkedin/*
registerSlackOauthRoutes(app); // /v1/oauth/slack/* (workspace admin install)
registerNotionOauthRoutes(app); // /v1/oauth/notion/*
registerMicrosoftOauth(app); // /v1/oauth/microsoft/* (outlook + teams)
registerTwitterOauthRoutes(app); // /v1/oauth/twitter/* (OAuth 2.0 + PKCE)
registerGithubOauthRoutes(app); // /v1/oauth/github/* (Classic OAuth, non-expiring access tokens)
registerRailwayOauthRoutes(app); // /v1/oauth/railway/* (OAuth 2.0 + PKCE; replaces the PAT routes from #95)
registerConnectionsRoutes(app); // /v1/me/connections — frontend reads this
registerOauthPlatformsRoute(app); // /v1/oauth/platforms — public config surface

// Dedup layer: Clay-callable matcher, API keys, Apple/Slack/magic-link.
// registerDedup defensively imports each route group so this block stays
// boot-safe even if individual WS-3/4/5/6 PRs land out of order. The
// dedup-status route below surfaces the per-group registration result
// (a public GET so we can diagnose 'works locally, 404 on Railway'
// situations without Railway log access).
let dedupReportFn = () => ({
  startedAt: null,
  finishedAt: null,
  attempted: 0,
  registered: 0,
  groups: [],
  entrypointError: "registerDedup never ran",
});
try {
  const { registerDedup, getDedupRegistrationReport } =
    await import("../dedup/api/index.js");
  await registerDedup(app);
  if (typeof getDedupRegistrationReport === "function") {
    dedupReportFn = getDedupRegistrationReport;
  }
} catch (err) {
  const msg = err && err.message ? err.message : String(err);
  app.log.warn({ msg }, "[dedup] registration entrypoint not available");
  dedupReportFn = () => ({
    startedAt: null,
    finishedAt: null,
    attempted: 0,
    registered: 0,
    groups: [],
    entrypointError: msg,
  });
}

app.get("/dedup/status", async () => dedupReportFn());

/**
 * Health is Cloud SQL and nothing else.
 *
 * This used to be `allHealthy = privyHealth.healthy && fsHealthy` -- the service
 * reported degraded unless it could reach BOTH Privy and Firestore, neither of
 * which it now talks to, and it never once checked the database every request
 * depends on. Now it checks the one thing that is actually load-bearing.
 */
app.get("/status", async () => {
  let dbHealthy = false;
  let dbDetail = "not_configured";
  try {
    const { rows } = await sqlQuery("SELECT current_database() AS db");
    dbHealthy = true;
    dbDetail = rows[0]?.db ?? "ok";
  } catch (err) {
    dbDetail = err?.message || "connection_failed";
  }

  return {
    status: dbHealthy ? "healthy" : "degraded",
    // What the boot guard found. "behind" here means the process was started
    // with ALLOW_PENDING_MIGRATIONS=true, because it would otherwise have
    // refused to listen at all.
    schema: {
      state: schemaFreshness.state,
      reason: schemaFreshness.reason,
      pending: schemaFreshness.pending,
    },
    service: "amber-id",
    version: "1.0.0",
    /*
     * WHICH COMMIT IS ACTUALLY RUNNING.
     *
     * Added after an hour spent unable to tell whether a push had reached the
     * running container. "Deployed" from a platform, a refreshed page and a
     * stale layer cache all look identical from outside; a commit SHA does
     * not. If this does not match what was pushed, the problem is the deploy.
     *
     * A commit SHA of a private repo is not a secret, and /status is already
     * public.
     */
    build: {
      commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      shortCommit: (process.env.RAILWAY_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
      branch: process.env.RAILWAY_GIT_BRANCH ?? null,
      startedAt: new Date(startedAt).toISOString(),
    },
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    database: { healthy: dbHealthy, detail: dbDetail },
    tenantIndex: {
      size: tenantIndex.getAll().length,
      senderMappings: tenantIndex._bySenderId?.size || 0,
    },
  };
});

// Root
app.get("/", async () => ({
  service: "amber-id",
  description: "Identity and tenant resolution for the Amber platform",
  endpoints: {
    status: "GET /status",
    resolve: "GET /tenants/resolve?sender_id=xxx",
    me: "GET /tenants/me (Bearer session token)",
    verify: "POST /auth/verify",
    onboard: "POST /auth/onboard",
    authMe: "GET /v1/auth/me",
    onboarding:
      "POST /v1/onboarding/start, PUT /v1/onboarding/step/:step, POST /v1/onboarding/complete, GET /v1/onboarding/status",
    profile:
      "GET /v1/me, PATCH /v1/me, GET /v1/me/contacts, POST /v1/me/contacts, POST /v1/me/people-rank, GET /v1/profile/:userId",
    privacy:
      "GET /v1/privacy/tier, PUT /v1/privacy/tier, GET /v1/privacy/permissions, PUT /v1/privacy/permissions, GET /v1/privacy/audit",
    internal:
      "GET /internal/users/:userId/context, GET /internal/users/:userId/contacts, POST /internal/auth/resolve-user, POST /internal/agents/group-chat/decide",
    numbers: "GET /numbers/pool",
    safety: "POST /v1/me/reports, POST /v1/me/dms/:id/block",
    legal: "GET /legal, GET /legal/privacy, GET /legal/terms",
    imessage: {
      ingest: "POST /ingest/imessage",
      recent: "POST /knowledge/imessage/recent",
      search: "POST /knowledge/imessage/search",
    },
    data: {
      get: "POST /v1/data/:table/get",
      query: "POST /v1/data/:table/query",
      upsert: "POST /v1/data/:table/upsert",
      insert: "POST /v1/data/:table/insert",
      delete: "POST /v1/data/:table/delete",
    },
    events: {
      create: "POST /v1/me/events",
      list: "GET /v1/me/events",
      get: "GET /v1/me/events/:event_id",
      patch: "PATCH /v1/me/events/:event_id",
      delete: "DELETE /v1/me/events/:event_id",
      addItems: "POST /v1/me/events/:event_id/items",
      listItems: "GET /v1/me/events/:event_id/items",
      plan: "GET /v1/me/events/:event_id/plan",
      summarize: "POST /v1/me/events/:event_id/summarize",
    },
  },
}));

// Start
const PORT = process.env.PORT || 3100;
const HOST = process.env.HOST || "0.0.0.0";

// Boot-time visibility: Cloud SQL is the OLTP backbone. If its required env
// vars are absent the process still boots (many read paths degrade), but a
// half-configured deploy is otherwise silent until the first DB call 500s.
// Log a loud, NON-fatal warning here so a misconfigured Railway env is
// obvious in the boot logs. We do NOT exit — see db/sql.js, which throws
// lazily on first use with the same missing-var list.
const REQUIRED_SQL_ENV = [
  "AMBER_SQL_CONNECTION_NAME",
  "AMBER_SQL_DB",
  "AMBER_SQL_USER",
  "AMBER_SQL_PASSWORD",
];
// Filled by the boot guard below; surfaced on /status so a schema that is
// behind is visible without going and reading the boot log.
let schemaFreshness = { state: "unknown", pending: [], reason: "not_checked" };

const missingSqlEnv = REQUIRED_SQL_ENV.filter((k) => !process.env[k]);
if (missingSqlEnv.length > 0) {
  console.error(
    `[startup] WARNING: Cloud SQL is not fully configured — missing env vars: ${missingSqlEnv.join(
      ", ",
    )}. The service will boot but any Cloud SQL-backed route will fail until these are set.`,
  );
}

// ── The schema this code was written against, before serving a byte ──────────
//
// Migrations 049 and 050 shipped and were never applied. Every event write,
// every reminder write and every agenda read threw for days while /status
// reported "healthy" -- nothing could be scheduled and nothing said so. A log
// line was not the missing piece; we had thousands of them.
//
// Exiting here does not take production down. Railway gates the rollout on
// healthcheckPath, so a process that never listens never takes traffic and the
// PREVIOUS deployment keeps serving against the schema it was built for. See
// db/schema-guard.js for why "cannot tell" always boots.
schemaFreshness = await enforceSchemaFreshness({
  loadApplied: missingSqlEnv.length
    ? null
    : async () => {
        const { rows } = await sqlQuery(
          "SELECT filename FROM schema_migrations",
        );
        return rows.map((r) => r.filename);
      },
});

try {
  await app.listen({ port: Number(PORT), host: HOST });
  console.log(`amber-id listening on ${HOST}:${PORT}`);

  /*
   * WHAT THE COMPANY-FACING DOORS NEED, AND WHETHER THEY HAVE IT.
   *
   * Both of these fail INVISIBLY when unset: the Google button hides itself
   * rather than leading somebody to "not configured", and an invitation is
   * created and then quietly not delivered. Each is the right behavior and
   * each leaves an operator staring at a screen with nothing on it. So the
   * state is printed once at boot, with the exact variable names, next to the
   * other startup lines where somebody is already looking.
   */
  {
    const google = Boolean(process.env.GOOGLE_SIGNIN_CLIENT_ID && process.env.GOOGLE_SIGNIN_CLIENT_SECRET);
    const base = process.env.AMBER_API_BASE_URL || "";
    if (google && base) {
      console.log(`[org-auth] google sign-in: ON -- callback ${base.replace(/\/+$/, "")}/v1/org/auth/google/callback`);
    } else {
      const missing = [
        process.env.GOOGLE_SIGNIN_CLIENT_ID ? null : "GOOGLE_SIGNIN_CLIENT_ID",
        process.env.GOOGLE_SIGNIN_CLIENT_SECRET ? null : "GOOGLE_SIGNIN_CLIENT_SECRET",
        base ? null : "AMBER_API_BASE_URL",
      ].filter(Boolean);
      console.warn(
        `[org-auth] google sign-in: OFF -- the button will not render. Set ${missing.join(", ")}` +
          ` (these are NOT the GOOGLE_CLIENT_ID/SECRET the dedup service uses)`,
      );
    }

    if (process.env.RESEND_API_KEY) {
      console.log(
        `[org-auth] email: ON -- sending as ${process.env.AMBER_EMAIL_FROM || "Amber <no-reply@amberintelligence.ai>"}.` +
          ` A 403 validation_error from Resend means that domain is not verified yet.`,
      );
    } else {
      console.warn("[org-auth] email: OFF -- invitations are created but never sent. Set RESEND_API_KEY.");
    }
  }
  // Kick off tenant index refresh in the background - do NOT block listen()
  tenantIndex.start().catch((err) => {
    console.warn("[startup] tenantIndex.start() failed:", err.message);
  });
  // Reminder delivery worker (tab-16). Gated by ENABLE_REMINDER_WORKER === "1"
  // so dev / test boots stay quiet. Needs MEDHA_PLATFORM_URL +
  // MEDHA_PLATFORM_ADMIN_TOKEN in Railway prod to actually deliver.
  startReminderWorker();
  // Derived scores have no writer at request time -- this is the only thing
  // that keeps dimensions, warmth and interaction counts current.
  startRollupWorker();
  // The relationship graph is built from a calendar and a mailbox, and both
  // change every day. Without this it is accurate the afternoon somebody set
  // it up and quietly wrong a week later.
  startGraphRefreshWorker();
  // Self-reminder delivery scheduler. Gated by ENABLE_REMINDER_SCHEDULER
  // (DEFAULT ON; set to "0" to disable). Ticks ~60s and delivers the iMessage
  // channel of reminders the user set FOR THEMSELVES (origin=self_reminder),
  // sending strictly to the owner's OWN number and DELETING the row on success
  // (delete-on-complete). Disjoint from startReminderWorker's cross-person rows.
  // Needs MEDHA_AGENT_URL + MEDHA_ADMIN_TOKEN to actually deliver.
  startReminderScheduler();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown: stop background refresh, close server, exit within 10s
async function shutdown(signal) {
  console.log(`[shutdown] ${signal} received, shutting down gracefully`);
  const forceExit = setTimeout(() => {
    console.error("[shutdown] Force exit after 10s timeout");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    tenantIndex.stop();
    await app.close();
    // Drain the Cloud SQL pool last so any in-flight request finishes on its
    // connection before we tear the pool down. Never let a pool-close error
    // block a clean exit.
    await closePool().catch(() => {});
    console.log("[shutdown] Clean exit");
    process.exit(0);
  } catch (err) {
    console.error("[shutdown] Error during shutdown:", err.message);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Last-resort safety nets. A stray rejected promise or a throw on a detached
// async path (background workers, fire-and-forget refreshes) must NOT take the
// whole service down — log it and keep serving. These are intentionally
// non-fatal: Fastify already isolates per-request errors via its own handler,
// so anything reaching here is out-of-band and recoverable.
process.on("unhandledRejection", (reason) => {
  const msg = reason && reason.message ? reason.message : String(reason);
  console.error("[process] unhandledRejection:", msg);
});
// An uncaughtException, by contrast, means we hit a throw on a path Node
// could not attribute to any handler — process state may be corrupted. Log
// it, then exit non-zero after a brief flush so the platform (Railway)
// restarts a clean process instead of serving on possibly-broken state.
process.on("uncaughtException", (err) => {
  console.error(
    "[process] uncaughtException (exiting):",
    err && err.stack
      ? err.stack
      : err && err.message
        ? err.message
        : String(err),
  );
  // Give stdout/stderr a moment to flush the line above before we exit.
  setTimeout(() => process.exit(1), 100).unref();
});
