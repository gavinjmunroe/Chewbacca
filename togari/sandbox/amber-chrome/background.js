/**
 * Amber LinkedIn — Background Service Worker
 *
 * Two triggers:
 *
 * 1. External message from the Amber frontend (chrome.runtime.sendMessage from
 *    medha-frontend-production-5f4f.up.railway.app). When the user clicks "Sync
 *    LinkedIn" on the Amber /connect page, the frontend sends a message to this
 *    extension. The extension reads the LinkedIn cookies and POSTs them to the
 *    medha-id cookie-sync endpoint. The user doesn't touch anything.
 *
 *    NOTE on host naming: cookies go to medha-id (the identity / OAuth /
 *    secrets-bag backend), NOT medha-platform (the iMessage agent service).
 *    Different Railway deployments, easy to confuse.
 *
 * 2. Popup click. The user opens the extension popup and clicks "Sync now"
 *    (or "Re-sync now" if they've already done one sync). Same flow, triggered
 *    from popup.js. This is the path most users will hit: every popup open
 *    that ends in a click re-uploads the freshest cookies and the backend
 *    re-fetches the user's current LinkedIn connections.
 *
 * Cookie reading via chrome.cookies API (requires "cookies" permission +
 * "https://www.linkedin.com/*" host_permissions). Same approach used by
 * SalesMind AI, PhantomBuster, Derrick, and every other LinkedIn workflow tool.
 *
 * Backend contract: POST <backendUrl>/v1/oauth/linkedin/cookies
 *   Headers: Authorization: Bearer <amber-jwt>
 *   Body:    { li_at: string, jsessionid: string }
 *   200:     { ok: true, connections_synced?: number }
 *   See BACKEND_INTEGRATION.md.
 */

const LINKEDIN_URL = "https://www.linkedin.com";
const COOKIE_NAMES = ["li_at", "JSESSIONID"];
const BACKEND_COOKIE_ENDPOINT = "/v1/oauth/linkedin/cookies";

// Allowlist of trusted Amber backends. The extension refuses to send LinkedIn
// cookies to any URL outside this list, even if a caller passes one via
// chrome.runtime.sendMessage. Second layer of defense after
// externally_connectable in manifest.json. Localhost is deliberately NOT here
// for the Web Store build; load an unpacked dev branch to add it locally.
const TRUSTED_BACKENDS = ["https://medha-id-production.up.railway.app"];

function isTrustedBackend(url) {
  try {
    const u = new URL(url);
    const origin = `${u.protocol}//${u.host}`;
    return TRUSTED_BACKENDS.includes(origin);
  } catch {
    return false;
  }
}

// Origins allowed to drive the extension over runtime.sendMessage. Mirrors
// externally_connectable.matches in manifest.json. Used to gate sender-side
// trust for set_auth_token / clear_auth_token, which carry user credentials.
const TRUSTED_SENDER_ORIGINS = [
  "https://www.justarock.ai",
  "https://justarock.ai",
  "https://medha-frontend-production-5f4f.up.railway.app",
  "https://medha-id-production.up.railway.app",
];

function isTrustedSender(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return TRUSTED_SENDER_ORIGINS.includes(`${u.protocol}//${u.host}`);
  } catch {
    return false;
  }
}

// Default backend used by the popup when the user hasn't been onboarded via
// the frontend yet. Production users will normally be wired via set_auth_token
// from the Amber frontend (which also writes backendUrl), so this default is
// only the fallback for "user installed before visiting the dashboard."
const DEFAULT_BACKEND = "https://medha-id-production.up.railway.app";

// ─── Read LinkedIn cookies from browser ──────────────────────────────────────

async function getLinkedInCookies() {
  const results = {};

  for (const name of COOKIE_NAMES) {
    const cookie = await chrome.cookies.get({ url: LINKEDIN_URL, name });
    if (cookie) results[name] = cookie.value;
  }

  return results;
}

// ─── Check if user is logged into LinkedIn ────────────────────────────────────

async function isLinkedInLoggedIn() {
  const cookie = await chrome.cookies.get({ url: LINKEDIN_URL, name: "li_at" });
  return !!cookie?.value;
}

// ─── POST cookies to Amber backend ───────────────────────────────────────────

async function sendCookiesToBackend(backendUrl, authToken, cookies) {
  const endpoint = `${backendUrl}${BACKEND_COOKIE_ENDPOINT}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      li_at: cookies["li_at"],
      jsessionid: cookies["JSESSIONID"],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Backend returned ${res.status}: ${text}`);
  }

  return res.json();
}

// ─── Core sync flow ───────────────────────────────────────────────────────────
// Used for both the first connection AND every re-sync after that. Every popup
// open that ends in a click runs this; idempotent server-side.

async function syncLinkedIn(backendUrl, authToken) {
  // 0. Refuse to send cookies to anything outside the allowlist. Defense in
  //    depth against a malicious caller that slips past externally_connectable.
  if (!isTrustedBackend(backendUrl)) {
    return {
      success: false,
      error: "untrusted_backend",
      message: `Refusing to send LinkedIn cookies to ${backendUrl}. Allowed: ${TRUSTED_BACKENDS.join(", ")}`,
    };
  }

  // 1. Check LinkedIn login
  const loggedIn = await isLinkedInLoggedIn();
  if (!loggedIn) {
    return {
      success: false,
      error: "not_logged_in",
      message: "Log into LinkedIn in this browser first, then try again.",
    };
  }

  // 2. Read cookies
  const cookies = await getLinkedInCookies();
  if (!cookies["li_at"]) {
    return {
      success: false,
      error: "no_cookie",
      message:
        "LinkedIn session cookie not found. Make sure you are logged in.",
    };
  }

  // 3. POST to backend
  try {
    const result = await sendCookiesToBackend(backendUrl, authToken, cookies);
    const now = new Date().toISOString();
    await chrome.storage.local.set({
      connected: true,
      connectedAt: now,
      lastSyncAt: now,
      lastSyncedCount:
        typeof result?.connections_synced === "number"
          ? result.connections_synced
          : null,
      backendUrl,
    });
    await updateBadge(true);
    const count = result?.connections_synced;
    const message =
      typeof count === "number"
        ? `Synced ${count} LinkedIn connections to Amber.`
        : "LinkedIn synced to Amber.";
    return { success: true, message, connections_synced: count ?? null };
  } catch (err) {
    return { success: false, error: "backend_error", message: err.message };
  }
}

// ─── Icon badge ──────────────────────────────────────────────────────────────
// Show a tiny dot on the icon: green when synced at least once, no badge when
// not. The user can re-sync at any time via the popup.

async function updateBadge(connected) {
  if (connected) {
    await chrome.action.setBadgeText({ text: " " });
    await chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}

chrome.runtime.onStartup.addListener(async () => {
  const { connected } = await chrome.storage.local.get(["connected"]);
  await updateBadge(Boolean(connected));
});

chrome.runtime.onInstalled.addListener(async () => {
  const { connected } = await chrome.storage.local.get(["connected"]);
  await updateBadge(Boolean(connected));
});

// ─── External message handler (from Amber frontend) ──────────────────────────
// The Amber /connect page calls:
//   chrome.runtime.sendMessage(EXTENSION_ID, { action, ... })
// The extension receives it here and responds.

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (!message?.action) return;

    if (message.action === "ping") {
      sendResponse({
        installed: true,
        version: chrome.runtime.getManifest().version,
      });
      return true;
    }

    if (message.action === "sync_linkedin") {
      const backendUrl = message.backendUrl || DEFAULT_BACKEND;
      const { authToken } = message;

      if (!authToken) {
        sendResponse({ success: false, error: "missing_auth_token" });
        return true;
      }

      syncLinkedIn(backendUrl, authToken)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));

      return true; // keep channel open for async response
    }

    if (message.action === "get_status") {
      chrome.storage.local.get(
        ["connected", "connectedAt", "lastSyncAt", "lastSyncedCount"],
        (data) => {
          sendResponse({ installed: true, ...data });
        },
      );
      return true;
    }

    // Frontend pushes the user's amber-jwt to the extension after sign-in so
    // the popup can act without re-prompting. Sender MUST be a trusted origin.
    if (message.action === "set_auth_token") {
      const { authToken, backendUrl } = message;
      const sourceOrigin = sender?.origin ?? sender?.url ?? "";
      if (!isTrustedSender(sourceOrigin)) {
        sendResponse({ success: false, error: "untrusted_sender" });
        return true;
      }
      if (typeof authToken !== "string" || !authToken) {
        sendResponse({ success: false, error: "missing_auth_token" });
        return true;
      }
      const persistBackend = isTrustedBackend(backendUrl)
        ? backendUrl
        : undefined;
      chrome.storage.local
        .set({
          authToken,
          ...(persistBackend ? { backendUrl: persistBackend } : {}),
        })
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.action === "clear_auth_token") {
      const sourceOrigin = sender?.origin ?? sender?.url ?? "";
      if (!isTrustedSender(sourceOrigin)) {
        sendResponse({ success: false, error: "untrusted_sender" });
        return true;
      }
      chrome.storage.local
        .remove([
          "authToken",
          "connected",
          "connectedAt",
          "lastSyncAt",
          "lastSyncedCount",
        ])
        .then(() => updateBadge(false))
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
  },
);

// ─── Internal message handler (from popup.js) ─────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "sync_linkedin_from_popup") {
    const backendUrl = message.backendUrl || DEFAULT_BACKEND;
    const { authToken } = message;
    syncLinkedIn(backendUrl, authToken)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "check_linkedin") {
    isLinkedInLoggedIn().then((loggedIn) => sendResponse({ loggedIn }));
    return true;
  }
});
