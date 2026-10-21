/**
 * Shared constants, configuration, and environment variables.
 * Single source of truth for all config across Amber.
 */

// ── AI Providers ─────────────────────────────────────────────────────────
// Perplexity is the single AI provider: Agent API for tools, Sonar for chat,
// embeddings via amber-id. No Claude/Anthropic keys, no Groq, no OpenAI.
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3";
export const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
export const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
export const EXA_API_KEY = process.env.EXA_API_KEY || null;

// ── Transport ────────────────────────────────────────────────────────────
export const TRANSPORT = (process.env.TRANSPORT || "loop").toLowerCase();
export const LOOP_API_KEY = process.env.LOOP_API_KEY;
export const LOOP_SECRET_KEY = process.env.LOOP_SECRET_KEY || "";
// Per-tenant: moved to amber-id. These exports are kept as empty strings
// so any stale `tenant?.loopSenderId || LOOP_SENDER_ID`-style fallbacks
// degrade to falsy rather than hard-crash during migration. Clean up as
// call sites are updated.
export const LOOP_SENDER_ID = "";
export const LOOP_SENDER_PHONE = "";
export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
export const TWILIO_PHONE = process.env.TWILIO_PHONE;

// ── Identity (per-tenant, sourced from amber-id tenant.phoneNumber) ──────
// Kept as a deprecated empty-string export during migration so `||`
// fallbacks in legacy code don't throw. New code must read
// `tenant.phoneNumber` off the resolved tenant object.
export const CALEB_PHONE = "";

// GITHUB_TOKEN: per-user via amber-id secrets store (key: GITHUB_PAT).
// See lib/tools/github.js — reads tenant-scoped PAT with env fallback.

// ── Tools ────────────────────────────────────────────────────────────────
export const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY;
export const TODOIST_API_KEY = process.env.TODOIST_API_KEY;

// ── amber-id (primary data plane — required) ─────────────────────────────
// Operational CRUD goes to /v1/data/*; private user knowledge goes to
// /knowledge/*. Both are backed on amber-id's side by GCP Firestore
// (operational) and Pinecone (per-user, 6-dimension namespaces).
export const AMBER_ID_API_URL = process.env.AMBER_ID_API_URL || null;
export const AMBER_ID_API_KEY = process.env.AMBER_ID_API_KEY || null;

// Flaw #33: medha-id is the canonical owner of embeddings — the agent
// proxies inbound/outbound writes through /v1/embeddings/* instead of
// computing vectors + writing BQ directly. Falls back to AMBER_ID_*
// so the existing Railway env keeps working during the cutover.
export const MEDHA_ID_URL =
  process.env.MEDHA_ID_URL || process.env.AMBER_ID_API_URL || null;
export const MEDHA_ID_API_KEY =
  process.env.MEDHA_ID_API_KEY || process.env.AMBER_ID_API_KEY || null;

// ── Privy (single auth authority) ────────────────────────────────────────
export const PRIVY_APP_ID = process.env.PRIVY_APP_ID || null;
export const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || null;

// ── CRM / Logging ────────────────────────────────────────────────────────
// CLAY_API_KEY / CLAY_TABLE_ID: per-user via amber-id secrets store.
// No runtime callers currently; the Tiwari opportunity adapter reads its
// own TOGARI_CLAY_API_KEY directly.
export const FIRESTORE_PROJECT_ID = process.env.FIRESTORE_PROJECT_ID;
export const FIRESTORE_SA_KEY_PATH = process.env.FIRESTORE_SA_KEY;
export const BMA_SLACK_WEBHOOK = process.env.BMA_SLACK_WEBHOOK;
export const BMA_KEYWORDS = (
  process.env.BMA_PROSPECT_KEYWORDS || "bma,prospect,investor,bd,deal"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// ── Amber API ────────────────────────────────────────────────────────────
export const AMBER_API_URL = process.env.AMBER_API_URL || null;

// ── Sign-up URL ──────────────────────────────────────────────────────────
// Public Medha sign-up landing page. Surfaced to:
//   • Slack users whose Slack identity isn't linked to a medha-id yet
//   • iMessage users whose phone has no medha-id behind it (expert-tenant)
//   • Anyone who asks Medha a personalized question (calendar, gmail, etc.)
//     before they have an account
// MUST include the leading www. — the bare-apex `justarock.ai` does not
// currently serve. Override via env if the domain changes.
export const JUSTAROCK_SIGNUP_URL =
  process.env.JUSTAROCK_SIGNUP_URL || "https://www.justarock.ai";

// ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID: per-user via amber-id secrets
// store. Voice venture (ventures/voice/amber-phone-call-ref) runs in its
// own deployment and reads these from its own env.

// ── Timing ───────────────────────────────────────────────────────────────
export const POLL_INTERVAL = 2000;
export const TOOLS_CACHE_DURATION = 60 * 60 * 1000; // 1 hour
export const MEMORY_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
export const HISTORY_LIMIT = 30;
export const FINGERPRINT_TTL = 30000; // 30 seconds
export const CALEB_FOCUSED_WINDOW_MS = 5 * 60 * 1000; // 5 min

// ── Directories ──────────────────────────────────────────────────────────
export const CONTACTS_DIR = "amber-contacts";
export const CONVERSATIONS_DIR = "amber-conversations";

// ── 6 Dimensions of Health ───────────────────────────────────────────────
// The lens through which Amber sees every person, every conversation,
// every search, and every memory.
// Masculine: Social, Financial, Intellectual
// Feminine: Spiritual, Physical, Emotional
export const HEALTH_DIMS = [
  "social",
  "financial",
  "intellectual",
  "spiritual",
  "physical",
  "emotional",
];

export const HEALTH_DIM_DESCRIPTIONS = {
  social:
    "connections, relationships, community, loneliness, belonging, friendships",
  financial: "stability, income, debt, career momentum, abundance, scarcity",
  intellectual: "learning, curiosity, growth, stimulation, boredom, creativity",
  spiritual:
    "faith, purpose, meaning, alignment, prayer, disconnection from God",
  physical: "energy, sleep, movement, nutrition, illness, exhaustion, fitness",
  emotional: "mood, regulation, peace, anxiety, depression, joy, overwhelm",
};

// ── Token Budget ─────────────────────────────────────────────────────────
export const MAX_SYSTEM_PROMPT_TOKENS = 30000; // ~120k chars
export const MAX_CONTEXT_CHARS = 80000; // trim context files beyond this
export const CHARS_PER_TOKEN = 4; // rough estimate
