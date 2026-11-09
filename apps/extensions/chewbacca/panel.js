// The extension's own page: the side panel, the setup steps, and the one-click
// grant. It is an extension origin, so the chat page can't script it, and a
// click here is the only place Chrome lets the extension ask for a site.

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

const PANES = {
  calendar: "Privacy_Calendars",
  reminders: "Privacy_Reminders",
  full_disk: "Privacy_AllFiles",
  automation: "Privacy_Automation",
};
let connected = false;

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "hello" });
  connected = !!(state && state.connected);
  $("[data-dot]").classList.toggle("on", connected);
  $("[data-status]").textContent = connected
    ? `Mac connected: ${state.tools.length} tools. Writes ask you on the Mac first.`
    : "Browser only. The free jobs work now; the steps below add your Mac.";
  document
    .querySelector('[data-step="install"]')
    .classList.toggle("done", connected);
  document
    .querySelector('[data-step="connect"]')
    .classList.toggle("done", connected);
  return connected;
}

$('[data-copy="install"]').addEventListener("click", async () => {
  await navigator.clipboard.writeText($("[data-install]").textContent.trim());
  $("[data-copied]").textContent = "Copied. Paste it in Terminal.";
});

$("[data-check]").addEventListener("click", async () => {
  const ok = await refresh();
  const note = $("[data-check-note]");
  note.classList.toggle("bad", !ok);
  note.textContent = ok
    ? "Connected."
    : "Not yet. Finish step 1, then quit and reopen Chrome once so it sees the Mac half.";
});

for (const b of document.querySelectorAll("[data-pane]")) {
  b.addEventListener("click", async () => {
    const pane = b.dataset.pane;
    const note = $("[data-pane-note]");
    if (connected) {
      const r = await chrome.runtime.sendMessage({ type: "open_pane", pane });
      note.textContent =
        r && r.ok
          ? "Opened in System Settings."
          : (r && r.error) || "Couldn't open it.";
      return;
    }
    // Without the Mac half, Chrome itself can hand the link to System Settings.
    await chrome.tabs.create({
      url: `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?${PANES[pane]}`,
    });
    note.textContent =
      "Chrome asks before opening System Settings. Press Open.";
  });
}

// --- the grant page: panel.html?grant=<origin>&job=<kind>&tab=<id>&chat=<id> ------
if (params.get("grant")) {
  document.body.classList.add("granting");
  const origin = params.get("grant");
  const host = origin.replace(/^https?:\/\//, "").replace(/\/\*$/, "");
  $("[data-grant-text]").textContent =
    `Chewbacca reads ${host} only when you ask, and puts what it read into your chat for you to send.`;
  $("[data-grant]").addEventListener("click", async () => {
    const ok = await chrome.permissions.request({ origins: [origin] });
    if (!ok) {
      $("[data-grant-note]").textContent = "Not allowed, so nothing was read.";
      return;
    }
    const chat = Number(params.get("chat")) || null;
    const r = await chrome.runtime.sendMessage({
      type: "job",
      kind: params.get("job"),
      tabId: Number(params.get("tab")),
      chat,
    });
    $("[data-grant-note]").textContent =
      r && r.ok
        ? "Done. It's in your chat's message box."
        : (r && r.error) || "That didn't work.";
    if (r && r.ok) setTimeout(() => window.close(), 1200);
  });
  $("[data-cancel]").addEventListener("click", () => window.close());
} else {
  refresh();
  if (location.hash === "#setup")
    document.getElementById("setup").scrollIntoView();
}
