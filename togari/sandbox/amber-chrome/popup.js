const DEFAULT_BACKEND_URL = "https://medha-id-production.up.railway.app";
const DASHBOARD_URL = "https://www.justarock.ai/connect";

async function getAuthState() {
  const data = await chrome.storage.local.get([
    "authToken",
    "backendUrl",
    "lastSyncAt",
    "lastSyncedCount",
    "connected",
  ]);
  return {
    authToken: data.authToken,
    backendUrl: data.backendUrl || DEFAULT_BACKEND_URL,
    lastSyncAt: data.lastSyncAt || null,
    lastSyncedCount:
      typeof data.lastSyncedCount === "number" ? data.lastSyncedCount : null,
    connected: !!data.connected,
  };
}

function showToast(msg, type = "success") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast toast-${type}`;
  el.style.display = "block";
  setTimeout(() => {
    el.style.display = "none";
  }, 4000);
}

function formatRelative(iso) {
  if (!iso) return "Never synced yet";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never synced yet";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Synced just now";
  if (min < 60) return `Synced ${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Synced ${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `Synced ${day}d ago`;
  return `Synced ${new Date(iso).toLocaleDateString()}`;
}

function setStatus({ dot, sub, btnText, btnDisabled, btnLabel }) {
  if (dot) document.getElementById("li-dot").className = `dot ${dot}`;
  if (sub !== undefined) document.getElementById("li-sub").textContent = sub;
  const btn = document.getElementById("li-btn");
  if (btnText !== undefined) btn.textContent = btnText;
  if (btnLabel !== undefined) btn.setAttribute("aria-label", btnLabel);
  btn.disabled = !!btnDisabled;
}

function setNote(msg, withDashboardLink = false) {
  const note = document.getElementById("note");
  if (withDashboardLink) {
    note.innerHTML = `${msg} <a href="#" id="open-dashboard">Open Amber</a>`;
    document
      .getElementById("open-dashboard")
      .addEventListener("click", openDashboard);
  } else {
    note.textContent = msg;
  }
}

function openDashboard(e) {
  if (e) e.preventDefault();
  chrome.tabs.create({ url: DASHBOARD_URL });
  window.close();
}

async function init() {
  const { loggedIn } = await new Promise((resolve) =>
    chrome.runtime.sendMessage({ action: "check_linkedin" }, resolve),
  );

  const { authToken, lastSyncAt, lastSyncedCount, connected } =
    await getAuthState();

  // Case A: user hasn't connected the extension to an Amber account yet
  if (!authToken) {
    setStatus({
      dot: "dot-gray",
      sub: "Not signed in to Amber",
      btnText: "Open Amber to sign in",
      btnDisabled: false,
    });
    document.getElementById("li-btn").onclick = openDashboard;
    setNote(
      "Sign in to Amber once and we'll wire this extension to your account automatically.",
      true,
    );
    return;
  }

  // Case B: not logged into LinkedIn in this browser
  if (!loggedIn) {
    setStatus({
      dot: "dot-gray",
      sub: "Not logged into LinkedIn",
      btnText: "Sync now",
      btnDisabled: true,
    });
    setNote(
      "Open linkedin.com and sign in. Then click the extension icon again.",
    );
    return;
  }

  // Case C: ready. Every open lets the user re-sync the latest connections.
  const countSuffix =
    typeof lastSyncedCount === "number"
      ? `, ${lastSyncedCount.toLocaleString()} connections`
      : "";
  const subLine = connected
    ? `${formatRelative(lastSyncAt)}${countSuffix}`
    : "Ready to sync";
  setStatus({
    dot: connected ? "dot-green" : "dot-amber",
    sub: subLine,
    btnText: connected ? "Re-sync now" : "Sync now",
    btnDisabled: false,
  });
  setNote(
    connected
      ? "Click any time to pull in new connections since your last sync."
      : "Click to import your LinkedIn connections into Amber.",
  );
}

async function syncLinkedIn() {
  const btn = document.getElementById("li-btn");
  btn.disabled = true;
  btn.textContent = "Syncing...";
  setStatus({
    dot: "dot-amber",
    sub: "Syncing with Amber...",
  });

  const { authToken, backendUrl } = await getAuthState();

  if (!authToken) {
    showToast("Not signed in to Amber. Opening dashboard...", "error");
    setTimeout(openDashboard, 800);
    return;
  }

  chrome.runtime.sendMessage(
    { action: "sync_linkedin_from_popup", backendUrl, authToken },
    (result) => {
      if (result?.success) {
        const count = result.connections_synced;
        const sub =
          typeof count === "number"
            ? `Synced just now, ${count.toLocaleString()} connections`
            : "Synced just now";
        setStatus({
          dot: "dot-green",
          sub,
          btnText: "Re-sync now",
          btnDisabled: false,
        });
        showToast(result.message || "Synced.", "success");
        setNote(
          "Click any time to pull in new connections since your last sync.",
        );
      } else {
        const msg = result?.message || "Something went wrong.";
        setStatus({
          dot: "dot-gray",
          sub: msg,
          btnText: "Retry",
          btnDisabled: false,
        });
        showToast(msg, "error");
      }
    },
  );
}

window.syncLinkedIn = syncLinkedIn;
init();
