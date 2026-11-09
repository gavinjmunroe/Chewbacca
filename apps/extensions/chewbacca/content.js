// Runs in the chat page (chatgpt.com, claude.ai), in the extension's isolated
// world. Two jobs: a small drawer for the free browser jobs and setup, and a
// watcher that hands chewbacca blocks from assistant messages to the Mac half.
//
// Nothing here is a security control. The page can read and click anything in
// its own DOM, so every decision lives in the native host. This file keeps
// the honest case pleasant: each block runs once, only from assistant
// messages, only after the message stops streaming, and results are pasted
// for the person to send, never sent.

(() => {
  const site = chewbSite(location.hostname);
  if (!site || window.__chewbacca) return;
  window.__chewbacca = true;

  const seen = new Set();
  let armed = false;
  let hostTools = null;
  const activity = [];

  // --- the drawer, in a shadow root so page CSS can't restyle it ------------------
  const mount = document.createElement("chewbacca-drawer");
  const root = mount.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap { position: fixed; right: 16px; bottom: 88px; z-index: 2147483646;
        font: 13px/1.45 Inter, ui-sans-serif, -apple-system, "Segoe UI", sans-serif; color: #ece8e1; }
      .pill { display: flex; align-items: center; gap: 8px; margin-left: auto; padding: 7px 12px;
        background: #1c1a17; border: 1px solid #34302a; border-radius: 999px; cursor: pointer;
        color: #ece8e1; font: inherit; transition: background 120ms ease-out, border-color 120ms ease-out; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #8a8378; }
      .dot.on { background: #e0a458; }
      .card { display: none; width: min(320px, calc(100vw - 32px)); margin-bottom: 8px; padding: 14px;
        background: #161412; border: 1px solid #2c2925; border-radius: 14px; }
      .open .card { display: block; }
      h2 { margin: 0 0 2px; font-size: 14px; font-weight: 600; }
      .sub { color: #a39c90; font-size: 12px; margin-bottom: 12px; }
      .label { color: #8a8378; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; margin: 12px 0 6px; }
      button.act { display: block; width: 100%; text-align: left; margin: 0 0 6px; padding: 8px 10px;
        background: #211e1a; border: 1px solid #2f2b26; border-radius: 9px; color: #ece8e1; font: inherit;
        cursor: pointer; transition: background 100ms ease-out, border-color 100ms ease-out, transform 120ms ease-out; }
      button.act:active { transform: scale(0.98); }
      button.primary { background: #e0a458; border-color: #e0a458; color: #1c1a17; font-weight: 600; }
      .hint { color: #a39c90; font-size: 12px; margin: 2px 0 6px; }
      .tabs button.act { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .log { font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #a39c90; }
      .log .denied, .log .refused, .log .failed { color: #d98572; }
      @media (hover: hover) and (pointer: fine) {
        .pill:hover { background: #24211d; border-color: #46413a; }
        button.act:hover { background: #2a2621; border-color: #46413a; }
        button.primary:hover { background: #e8b36d; }
      }
    </style>
    <div class="wrap">
      <div class="card" role="dialog" aria-label="Chewbacca">
        <h2>Chewbacca</h2>
        <div class="sub" data-status>Checking for the Mac half...</div>
        <div class="label">Free, right here</div>
        <button class="act" data-job="summarize">Summarize one of my tabs</button>
        <div class="tabs" data-tabs hidden></div>
        <button class="act" data-job="due">What's due on Brightspace</button>
        <div class="hint">Draft a reply: select text on any page, right-click, Draft a reply with Chewbacca.</div>
        <div class="label">On your Mac</div>
        <div data-mac></div>
        <div class="label" data-loghead hidden>Calls</div>
        <div class="log" data-log></div>
      </div>
      <button class="pill" data-toggle aria-expanded="false"><span class="dot" data-dot></span>Chewbacca</button>
    </div>`;
  document.documentElement.appendChild(mount);
  const $ = (s) => root.querySelector(s);

  // A click the page synthesized has isTrusted false. Not a boundary, but it
  // keeps a page script from driving the drawer for free.
  const onClick = (el, fn) =>
    el.addEventListener("click", (e) => {
      if (e.isTrusted) fn(e);
    });

  onClick($("[data-toggle]"), () => {
    const wrap = $(".wrap");
    wrap.classList.toggle("open");
    $("[data-toggle]").setAttribute(
      "aria-expanded",
      String(wrap.classList.contains("open")),
    );
  });

  onClick($('[data-job="summarize"]'), async () => {
    const box = $("[data-tabs]");
    const { tabs } = await chrome.runtime.sendMessage({ type: "tabs" });
    box.replaceChildren(
      ...(tabs.length ? tabs : [{ id: 0, title: "No other tabs open" }]).map(
        (t) => {
          const b = document.createElement("button");
          b.className = "act";
          b.textContent = t.title;
          if (t.id) onClick(b, () => job("summarize", t.id));
          return b;
        },
      ),
    );
    box.hidden = false;
  });
  onClick($('[data-job="due"]'), () => job("due"));

  async function job(kind, tabId) {
    setStatus(
      kind === "due" ? "Reading Brightspace..." : "Reading that tab...",
    );
    const r = await chrome.runtime.sendMessage({ type: "job", kind, tabId });
    setStatus(
      r && r.ok
        ? "Done. It's in the message box, press send when it looks right."
        : (r && r.error) || "That didn't work.",
    );
    $("[data-tabs]").hidden = true;
  }

  function setStatus(text) {
    $("[data-status]").textContent = text;
  }

  function renderMac(state) {
    const mac = $("[data-mac]");
    mac.replaceChildren();
    $("[data-dot]").classList.toggle("on", state.connected);
    if (state.connected) {
      hostTools = state.tools;
      setStatus(
        `Mac connected. ${state.tools.length} tools; writes ask you on the Mac first.`,
      );
      const teach = document.createElement("button");
      teach.className = "act primary";
      teach.textContent = "Teach this chat the tools";
      onClick(teach, () => chewbFillComposer(site, chewbPrimer(hostTools)));
      mac.append(teach);
    } else {
      setStatus("Browser only. The free jobs work now.");
      const get = document.createElement("button");
      get.className = "act primary";
      get.textContent = "Get the Mac half (4 steps)";
      onClick(get, () => chrome.runtime.sendMessage({ type: "setup" }));
      mac.append(get);
    }
  }

  function logCall(reply) {
    activity.unshift(reply);
    activity.length = Math.min(activity.length, 4);
    $("[data-loghead]").hidden = false;
    $("[data-log]").replaceChildren(
      ...activity.map((r) => {
        const row = document.createElement("div");
        row.className = r.verdict;
        row.textContent = `${r.tool}  ${r.verdict}  ${r.ms} ms`;
        return row;
      }),
    );
  }

  // --- the watcher ---------------------------------------------------------------
  function messages() {
    return chewbAll(document, site.assistant).filter(
      (el) => !site.user.some((u) => el.closest(u)),
    );
  }

  function streaming() {
    return site.streaming.some((s) => document.querySelector(s));
  }

  async function scan() {
    if (streaming()) return;
    const list = messages();
    for (let i = 0; i < list.length; i++) {
      const calls = chewbCallsFromElement(list[i]);
      for (let j = 0; j < calls.length; j++) {
        const key = chewbKey(calls[j], `${i}.${j}`);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!armed) continue; // present at page load: an old conversation, never re-run
        const reply = await chrome.runtime.sendMessage({
          type: "call",
          call: calls[j],
        });
        logCall(reply);
        chewbFillComposer(site, chewbFormatResult(reply));
      }
    }
  }

  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    // Both sites stream a reply in bursts; 800 ms of quiet means it finished.
    timer = setTimeout(scan, 800);
  }).observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });

  scan().then(() =>
    setTimeout(() => {
      scan().then(() => {
        armed = true;
      });
    }, 1500),
  );

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "fill") chewbFillComposer(site, msg.text);
    if (msg && msg.type === "mac") renderMac(msg);
  });
  chrome.runtime
    .sendMessage({ type: "hello" })
    .then(renderMac, () => renderMac({ connected: false }));
})();
