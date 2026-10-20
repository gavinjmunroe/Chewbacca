/*
 * Togari — connect.js
 *
 * Drives the /connect dashboard:
 *   - Scroll-aware nav (mandatory pattern from CLAUDE.md)
 *   - Fetches /dnc/auth/status to render platform connection state
 *   - Opens OAuth popups for the 7 social platforms
 *   - Posts iCloud app-specific password to /dnc/auth/apple/credentials (WS-3)
 *   - Surfaces ephemeral toasts for success / error
 *
 * Auth: reads Bearer token from localStorage('togari_token').
 * If missing, shows the inline sign-in panel. Once set, all calls
 * include Authorization: Bearer <token>.
 */

(function () {
  const TOKEN_KEY = "togari_token";
  const APPLE_LOCAL_KEY = "togari_apple_connected_email";

  const PLATFORMS = [
    {
      id: "linkedin",
      name: "LinkedIn",
      blurb: "Title, company, headline, current role.",
      accent: "#0a66c2",
      icon: "linkedin",
    },
    {
      id: "instagram",
      name: "Instagram",
      blurb: "Handle, bio, follower signal.",
      accent: "#e1306c",
      icon: "instagram",
    },
    {
      id: "twitter",
      name: "X / Twitter",
      blurb: "Username, verified status, bio.",
      accent: "#e7e9ea",
      icon: "twitter",
    },
    {
      id: "gmail",
      name: "Gmail",
      blurb: "Email signature parsing for org + title.",
      accent: "#ea4335",
      icon: "mail",
    },
    {
      id: "github",
      name: "GitHub",
      blurb: "Org, repos, bio, location.",
      accent: "#f0f6fc",
      icon: "github",
    },
    {
      id: "tiktok",
      name: "TikTok",
      blurb: "Username, follower count, bio.",
      accent: "#69c9d0",
      icon: "music",
    },
    {
      id: "snapchat",
      name: "Snapchat",
      blurb: "Username, display name.",
      accent: "#fffc00",
      icon: "ghost",
    },
  ];

  // ── Scroll-aware nav ────────────────────────────────────────────────────────
  function initScrollNav() {
    const nav = document.getElementById("tg-nav");
    if (!nav) return;
    function update() {
      const scrollY = window.scrollY;
      const docHeight = document.documentElement.scrollHeight;
      const winHeight = window.innerHeight;
      const nearBottom = scrollY + winHeight >= docHeight - 200;
      const visible = scrollY > 80 && !nearBottom;
      nav.classList.toggle("tg-nav-visible", visible);
    }
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  }

  // ── Toasts ──────────────────────────────────────────────────────────────────
  function toast(message, kind) {
    const wrap = document.getElementById("tg-toasts");
    if (!wrap) return;
    const node = document.createElement("div");
    const colorMap = {
      ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
      err: "border-red-500/30 bg-red-500/10 text-red-100",
      info: "border-indigo-500/30 bg-indigo-500/10 text-indigo-100",
    };
    const cls = colorMap[kind] || colorMap.info;
    node.className =
      "tg-toast pointer-events-auto max-w-sm rounded-xl border px-4 py-3 text-sm tg-glass " +
      cls;
    node.textContent = message;
    wrap.appendChild(node);
    setTimeout(() => {
      node.style.transition = "opacity 0.3s ease";
      node.style.opacity = "0";
      setTimeout(() => node.remove(), 300);
    }, 3600);
  }

  // ── Auth helpers ────────────────────────────────────────────────────────────
  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(value) {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  }

  async function api(path, options) {
    const token = getToken();
    if (!token) throw new Error("Not signed in");
    const headers = Object.assign(
      { Authorization: "Bearer " + token },
      options && options.body ? { "Content-Type": "application/json" } : {},
      (options && options.headers) || {},
    );
    const res = await fetch(path, Object.assign({}, options, { headers }));
    if (res.status === 401) {
      setToken(null);
      showUnauth();
      throw new Error("Session expired");
    }
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body.error || JSON.stringify(body);
      } catch (_) {
        detail = res.statusText;
      }
      throw new Error(detail || "Request failed");
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // ── Status rendering ────────────────────────────────────────────────────────
  function showUnauth() {
    document.getElementById("tg-unauth").classList.remove("hidden");
    const grid = document.getElementById("tg-platforms");
    grid.innerHTML = "";
    grid.setAttribute("aria-busy", "false");
  }

  function hideUnauth() {
    document.getElementById("tg-unauth").classList.add("hidden");
  }

  function renderAppleStatus(connectedEmail) {
    const badge = document.getElementById("tg-apple-status");
    if (!badge) return;
    if (connectedEmail) {
      badge.className =
        "inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20";
      badge.innerHTML =
        '<span class="tg-dot tg-dot-on"></span> Connected as ' +
        escapeHtml(connectedEmail);
    } else {
      badge.className =
        "inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700";
      badge.innerHTML = '<span class="tg-dot tg-dot-off"></span> Not connected';
    }
  }

  function platformCard(platform, isConnected, detail) {
    const dotClass = isConnected ? "tg-dot-on" : "tg-dot-off";
    const statusLabel = isConnected ? "Connected" : "Not connected";
    const detailLine = detail
      ? '<p class="text-xs text-zinc-500 mt-1 truncate">' +
        formatDetail(platform.id, detail) +
        "</p>"
      : "";
    const actionBtn = isConnected
      ? `
        <button
          data-action="disconnect"
          data-platform="${platform.id}"
          class="text-xs text-zinc-400 hover:text-red-400 transition-all duration-200 cursor-pointer inline-flex items-center gap-1"
        >
          <i data-lucide="unlink" class="w-3.5 h-3.5"></i>
          Disconnect
        </button>`
      : `
        <button
          data-action="connect"
          data-platform="${platform.id}"
          class="inline-flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-medium px-4 py-2 rounded-xl transition-all duration-200 cursor-pointer text-sm w-full"
        >
          <i data-lucide="link" class="w-4 h-4"></i>
          Connect
        </button>`;

    return `
      <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 tg-card-hover flex flex-col">
        <header class="flex items-start justify-between gap-3 mb-3">
          <div class="flex items-center gap-3 min-w-0">
            <span
              class="inline-flex items-center justify-center w-10 h-10 rounded-xl border"
              style="background: ${platform.accent}1a; border-color: ${platform.accent}33;"
            >
              <i data-lucide="${platform.icon}" class="w-5 h-5" style="color: ${platform.accent};"></i>
            </span>
            <div class="min-w-0">
              <h3 class="font-semibold tracking-tight truncate">${platform.name}</h3>
              <p class="text-xs text-zinc-500 truncate">${platform.blurb}</p>
            </div>
          </div>
          <span class="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-medium text-zinc-500 flex-shrink-0">
            <span class="tg-dot ${dotClass}"></span>
            ${statusLabel}
          </span>
        </header>
        ${detailLine}
        <div class="mt-auto pt-4 flex items-center justify-between gap-2">
          ${actionBtn}
        </div>
      </article>`;
  }

  function formatDetail(platformId, detail) {
    if (!detail) return "";
    if (detail.twitter_username) return "@" + detail.twitter_username;
    if (detail.instagram_account_id)
      return "IG ID " + detail.instagram_account_id;
    if (detail.connected_at) {
      const d = new Date(detail.connected_at);
      if (!isNaN(d)) return "Linked " + d.toLocaleDateString();
    }
    return "";
  }

  function escapeHtml(value) {
    if (value == null) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderPlatformGrid(connected, detail) {
    const grid = document.getElementById("tg-platforms");
    if (!grid) return;
    grid.setAttribute("aria-busy", "false");
    grid.innerHTML = PLATFORMS.map((p) =>
      platformCard(p, connected.indexOf(p.id) >= 0, detail[p.id]),
    ).join("");
    if (window.lucide) window.lucide.createIcons();
  }

  function renderGridError(message) {
    const grid = document.getElementById("tg-platforms");
    const err = document.getElementById("tg-feed-error");
    grid.innerHTML = "";
    grid.setAttribute("aria-busy", "false");
    err.classList.remove("hidden");
    err.innerHTML = `
      <div class="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 flex items-start gap-3">
        <i data-lucide="alert-triangle" class="w-5 h-5 text-red-400 mt-0.5"></i>
        <div class="flex-1">
          <h3 class="font-semibold text-red-100">Couldn't load connections</h3>
          <p class="mt-1 text-sm text-red-200/70">${escapeHtml(message)}</p>
          <button
            id="tg-retry"
            class="mt-3 inline-flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-medium px-4 py-2 rounded-xl transition-all duration-200 cursor-pointer text-sm"
          >
            <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
            Try again
          </button>
        </div>
      </div>`;
    document.getElementById("tg-retry").addEventListener("click", loadStatus);
    if (window.lucide) window.lucide.createIcons();
  }

  // ── Status loading ──────────────────────────────────────────────────────────
  async function loadStatus() {
    document.getElementById("tg-feed-error").classList.add("hidden");
    const grid = document.getElementById("tg-platforms");
    grid.setAttribute("aria-busy", "true");
    grid.innerHTML = PLATFORMS.map(
      () => '<div class="tg-skeleton h-40"></div>',
    ).join("");

    renderAppleStatus(localStorage.getItem(APPLE_LOCAL_KEY));

    try {
      const status = await api("/dnc/auth/status");
      hideUnauth();
      const connected = (status && status.connected) || [];
      const detail = (status && status.detail) || {};
      renderPlatformGrid(connected, detail);

      if (
        connected.indexOf("apple") >= 0 &&
        detail.apple &&
        detail.apple.email
      ) {
        localStorage.setItem(APPLE_LOCAL_KEY, detail.apple.email);
        renderAppleStatus(detail.apple.email);
      }
    } catch (err) {
      if (
        err.message === "Not signed in" ||
        err.message === "Session expired"
      ) {
        showUnauth();
        return;
      }
      renderGridError(err.message);
    }
  }

  // ── Connect / disconnect actions ────────────────────────────────────────────
  async function connectOAuth(platformId) {
    const token = getToken();
    if (!token) {
      showUnauth();
      return;
    }

    // The OAuth init endpoint requires an Authorization header, so a raw
    // window.open() won't work. We fetch in JSON mode to get the redirect URL,
    // then open it in a popup. The current server redirects on GET, so we
    // follow redirect manually via res.url.
    try {
      const res = await fetch("/dnc/auth/" + platformId, {
        headers: { Authorization: "Bearer " + token },
        redirect: "manual",
      });
      // 'manual' redirect: status 0 + type 'opaqueredirect' on cross-origin,
      // or 3xx on same-origin. We can't read Location in opaqueredirect mode,
      // so fall back to letting fetch follow and reading res.url.
      let target = res.url;
      if (!target || target.indexOf("http") !== 0) {
        const followed = await fetch("/dnc/auth/" + platformId, {
          headers: { Authorization: "Bearer " + token },
        });
        target = followed.url;
      }
      if (!target) throw new Error("No OAuth URL returned");

      const popup = window.open(
        target,
        "tg-oauth-" + platformId,
        "width=560,height=720,menubar=no,toolbar=no",
      );
      if (!popup) {
        toast("Popup blocked. Allow popups for Togari and retry.", "err");
        return;
      }

      const poll = setInterval(() => {
        if (popup.closed) {
          clearInterval(poll);
          toast("Checking connection…", "info");
          setTimeout(loadStatus, 600);
        }
      }, 700);
    } catch (err) {
      toast("Couldn't start OAuth: " + err.message, "err");
    }
  }

  async function disconnectPlatform(platformId) {
    const ok = window.confirm(
      "Disconnect " +
        platformId +
        "? Existing contacts stay; future syncs stop.",
    );
    if (!ok) return;
    try {
      await api("/dnc/auth/" + platformId, { method: "DELETE" });
      toast(platformId + " disconnected", "ok");
      loadStatus();
    } catch (err) {
      toast("Disconnect failed: " + err.message, "err");
    }
  }

  // ── Apple credentials submission ────────────────────────────────────────────
  async function submitAppleCredentials(event) {
    event.preventDefault();
    const emailEl = document.getElementById("tg-apple-email");
    const pwEl = document.getElementById("tg-apple-password");
    const feedback = document.getElementById("tg-apple-feedback");

    const email = emailEl.value.trim();
    const password = pwEl.value.trim();
    if (!email || !password) return;

    feedback.textContent = "Verifying with iCloud…";
    feedback.className = "text-xs text-indigo-300 min-h-[1rem]";

    try {
      await api("/dnc/auth/apple/credentials", {
        method: "POST",
        body: JSON.stringify({ email: email, app_password: password }),
      });
      localStorage.setItem(APPLE_LOCAL_KEY, email);
      renderAppleStatus(email);
      pwEl.value = "";
      feedback.textContent = "Connected. Syncing in the background.";
      feedback.className = "text-xs text-emerald-400 min-h-[1rem]";
      toast("Apple Contacts connected", "ok");
      loadStatus();
    } catch (err) {
      feedback.textContent = err.message;
      feedback.className = "text-xs text-red-400 min-h-[1rem]";
    }
  }

  // ── Wiring ──────────────────────────────────────────────────────────────────
  function wireEvents() {
    document.getElementById("tg-token-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const value = document.getElementById("tg-token-input").value.trim();
      if (!value) return;
      setToken(value);
      hideUnauth();
      loadStatus();
    });

    document
      .getElementById("tg-apple-form")
      .addEventListener("submit", submitAppleCredentials);

    document.getElementById("tg-refresh").addEventListener("click", loadStatus);

    document.getElementById("tg-platforms").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      const platform = btn.getAttribute("data-platform");
      if (action === "connect") connectOAuth(platform);
      else if (action === "disconnect") disconnectPlatform(platform);
    });
  }

  // ── Boot ────────────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    if (window.lucide) window.lucide.createIcons();
    initScrollNav();
    wireEvents();
    if (!getToken()) {
      showUnauth();
      return;
    }
    loadStatus();
  });
})();
