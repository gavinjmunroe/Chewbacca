/*
 * Togari — api-keys.js
 *
 * Drives the /api-keys dashboard:
 *   - Scroll-aware nav (mandatory CLAUDE.md pattern)
 *   - GET  /api/v1/keys                — list user's keys (prefix + name + last used)
 *   - POST /api/v1/keys                — issue a new key (full value shown once)
 *   - DELETE /api/v1/keys/:keyId       — revoke a key
 *
 * All three calls require an Auth0 JWT (NOT the API key itself), so reuse
 * the same togari_token used on /connect.
 */

(function () {
  const TOKEN_KEY = "togari_token";

  // ── Scroll-aware nav ────────────────────────────────────────────────────────
  function initScrollNav() {
    const nav = document.getElementById("tg-nav");
    if (!nav) return;
    function update() {
      const scrollY = window.scrollY;
      const docHeight = document.documentElement.scrollHeight;
      const winHeight = window.innerHeight;
      const nearBottom = scrollY + winHeight >= docHeight - 200;
      nav.classList.toggle("tg-nav-visible", scrollY > 80 && !nearBottom);
    }
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  }

  // ── Toasts ──────────────────────────────────────────────────────────────────
  function toast(message, kind) {
    const wrap = document.getElementById("tg-toasts");
    if (!wrap) return;
    const colorMap = {
      ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
      err: "border-red-500/30 bg-red-500/10 text-red-100",
      info: "border-indigo-500/30 bg-indigo-500/10 text-indigo-100",
    };
    const node = document.createElement("div");
    node.className =
      "tg-toast pointer-events-auto max-w-sm rounded-xl border px-4 py-3 text-sm tg-glass " +
      (colorMap[kind] || colorMap.info);
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

  // ── Visibility helpers ──────────────────────────────────────────────────────
  function showUnauth() {
    document.getElementById("tg-unauth").classList.remove("hidden");
    document.getElementById("tg-keys").innerHTML = "";
    document.getElementById("tg-keys").setAttribute("aria-busy", "false");
    document.getElementById("tg-keys-count").textContent =
      "Sign in to see keys.";
  }
  function hideUnauth() {
    document.getElementById("tg-unauth").classList.add("hidden");
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

  function relativeDate(value) {
    if (!value) return "Never used";
    const date = new Date(value);
    if (isNaN(date)) return "Never used";
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return minutes + "m ago";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h ago";
    const days = Math.floor(hours / 24);
    if (days < 30) return days + "d ago";
    return date.toLocaleDateString();
  }

  // ── List rendering ──────────────────────────────────────────────────────────
  function renderList(keys) {
    const list = document.getElementById("tg-keys");
    const state = document.getElementById("tg-keys-state");
    const count = document.getElementById("tg-keys-count");
    list.setAttribute("aria-busy", "false");

    if (!keys.length) {
      list.innerHTML = "";
      state.classList.remove("hidden");
      state.innerHTML = `
        <div class="rounded-3xl border border-dashed border-zinc-800 bg-zinc-900/40 p-10 text-center">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 mb-4">
            <i data-lucide="key-round" class="w-5 h-5 text-indigo-300"></i>
          </div>
          <h3 class="font-semibold text-lg tracking-tight">No keys yet</h3>
          <p class="mt-2 text-sm text-zinc-500 max-w-sm mx-auto">
            Generate your first long-lived bearer token to start calling Togari from Clay or your own scripts.
          </p>
          <button
            data-action="new-key"
            class="mt-5 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold px-5 py-2.5 rounded-xl transition-all duration-200 tg-glow cursor-pointer"
          >
            <i data-lucide="plus" class="w-4 h-4"></i>
            New API key
          </button>
        </div>`;
      count.textContent = "0 keys";
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    state.classList.add("hidden");
    count.textContent = keys.length + (keys.length === 1 ? " key" : " keys");

    list.innerHTML = keys
      .map((key) => {
        const prefix = escapeHtml(
          key.keyPrefix || key.key_prefix || "tgi_live_",
        );
        const name = escapeHtml(key.name || "Unnamed key");
        const keyId = escapeHtml(key.keyId || key.key_id || "");
        const createdAt = key.createdAt || key.created_at;
        const lastUsedAt = key.lastUsedAt || key.last_used_at;
        const createdLabel = createdAt
          ? "Created " + relativeDate(createdAt)
          : "";
        return `
        <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 tg-card-hover flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="font-semibold tracking-tight truncate">${name}</h3>
              <span class="text-[10px] uppercase tracking-wider font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                Active
              </span>
            </div>
            <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
              <code style="font-family: 'JetBrains Mono', monospace;">${prefix}…</code>
              <span>${createdLabel}</span>
              <span>·</span>
              <span>Last used ${relativeDate(lastUsedAt)}</span>
            </div>
          </div>
          <button
            data-action="revoke"
            data-key-id="${keyId}"
            data-key-name="${name}"
            class="self-start sm:self-center inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-red-400 transition-all duration-200 cursor-pointer"
          >
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            Revoke
          </button>
        </article>`;
      })
      .join("");

    if (window.lucide) window.lucide.createIcons();
  }

  function renderListError(message) {
    const list = document.getElementById("tg-keys");
    const state = document.getElementById("tg-keys-state");
    list.innerHTML = "";
    list.setAttribute("aria-busy", "false");
    state.classList.remove("hidden");
    state.innerHTML = `
      <div class="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 flex items-start gap-3">
        <i data-lucide="alert-triangle" class="w-5 h-5 text-red-400 mt-0.5"></i>
        <div class="flex-1">
          <h3 class="font-semibold text-red-100">Couldn't load keys</h3>
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
    document.getElementById("tg-retry").addEventListener("click", loadKeys);
    if (window.lucide) window.lucide.createIcons();
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  async function loadKeys() {
    const list = document.getElementById("tg-keys");
    list.setAttribute("aria-busy", "true");
    list.innerHTML =
      '<div class="tg-skeleton h-20"></div><div class="tg-skeleton h-20"></div>';
    document.getElementById("tg-keys-state").classList.add("hidden");
    try {
      const data = await api("/api/v1/keys");
      hideUnauth();
      const keys =
        (data && (data.keys || data.items)) ||
        (Array.isArray(data) ? data : []);
      renderList(keys);
    } catch (err) {
      if (
        err.message === "Not signed in" ||
        err.message === "Session expired"
      ) {
        showUnauth();
        return;
      }
      renderListError(err.message);
    }
  }

  // ── Modal helpers ───────────────────────────────────────────────────────────
  function openModal(id) {
    const modal = document.getElementById("tg-" + id + "-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
  function closeModal(id) {
    const modal = document.getElementById("tg-" + id + "-modal");
    if (!modal) return;
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }

  // ── Create key flow ─────────────────────────────────────────────────────────
  async function submitCreate(event) {
    event.preventDefault();
    const nameEl = document.getElementById("tg-create-name");
    const name = nameEl.value.trim();
    if (!name) return;
    const btn = event.target.querySelector('button[type="submit"]');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generating…";

    try {
      const result = await api("/api/v1/keys", {
        method: "POST",
        body: JSON.stringify({ name: name }),
      });
      const key = (result && result.key) || (result && result.api_key);
      if (!key) throw new Error("Server returned no key value");
      nameEl.value = "";
      closeModal("create");
      showRevealedKey(key);
      loadKeys();
    } catch (err) {
      toast("Couldn't create key: " + err.message, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  function showRevealedKey(key) {
    const value = document.getElementById("tg-reveal-value");
    value.textContent = key;
    document.getElementById("tg-reveal-feedback").textContent = "";
    openModal("reveal");
  }

  async function copyRevealedKey() {
    const value = document.getElementById("tg-reveal-value").textContent || "";
    const feedback = document.getElementById("tg-reveal-feedback");
    try {
      await navigator.clipboard.writeText(value);
      feedback.textContent = "Copied to clipboard.";
      feedback.className = "mt-3 text-xs text-emerald-400 min-h-[1rem]";
    } catch (_) {
      feedback.textContent =
        "Couldn't access clipboard. Select the key above and copy manually.";
      feedback.className = "mt-3 text-xs text-amber-400 min-h-[1rem]";
    }
  }

  // ── Revoke flow ─────────────────────────────────────────────────────────────
  async function revokeKey(keyId, name) {
    const ok = window.confirm(
      'Revoke "' +
        name +
        '"? Any client using this key will start getting 401.',
    );
    if (!ok) return;
    try {
      await api("/api/v1/keys/" + encodeURIComponent(keyId), {
        method: "DELETE",
      });
      toast("Key revoked", "ok");
      loadKeys();
    } catch (err) {
      toast("Revoke failed: " + err.message, "err");
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
      loadKeys();
    });

    document.getElementById("tg-new-key").addEventListener("click", () => {
      if (!getToken()) {
        showUnauth();
        toast("Sign in first", "info");
        return;
      }
      openModal("create");
      setTimeout(() => {
        document.getElementById("tg-create-name").focus();
      }, 50);
    });

    document
      .getElementById("tg-create-form")
      .addEventListener("submit", submitCreate);
    document
      .getElementById("tg-reveal-copy")
      .addEventListener("click", copyRevealedKey);

    document.body.addEventListener("click", (e) => {
      const closeBtn = e.target.closest("[data-close-modal]");
      if (closeBtn) closeModal(closeBtn.getAttribute("data-close-modal"));

      const stateBtn = e.target.closest('[data-action="new-key"]');
      if (stateBtn) {
        document.getElementById("tg-new-key").click();
      }

      const revokeBtn = e.target.closest('[data-action="revoke"]');
      if (revokeBtn) {
        revokeKey(
          revokeBtn.getAttribute("data-key-id"),
          revokeBtn.getAttribute("data-key-name") || "this key",
        );
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal("create");
        closeModal("reveal");
      }
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
    loadKeys();
  });
})();
