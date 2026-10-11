import { renderBlock } from "./render.js";

const $ = (s) => document.querySelector(s);

// Real DOM for render.js. Text is always a text node; `style` goes through
// CSSOM so the page's CSP never needs 'unsafe-inline'.
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null) continue;
    if (k === "style") {
      for (const decl of String(v).split(";")) {
        const i = decl.indexOf(":");
        if (i > 0)
          el.style.setProperty(
            decl.slice(0, i).trim(),
            decl.slice(i + 1).trim(),
          );
      }
    } else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const SUGGESTIONS = [
  "How did this week go?",
  "Which campaign is working?",
  "What needs me?",
  "Who replied about Ivy?",
];

let current = null;

async function boot() {
  const r = await fetch("/api/me");
  if (r.status === 401) return location.assign("/");
  if (!r.ok) {
    $("#feed").replaceChildren(
      h(
        "div",
        { class: "notice warn" },
        "Your numbers are not loading right now. Refresh in a minute.",
      ),
    );
    return;
  }
  const me = await r.json();
  $("#client-name").textContent = me.name;
  document.title = `${me.name} Live`;
  setSync(me.clay_sync_online);
  const chips = me.companies.length
    ? [
        SUGGESTIONS[0],
        SUGGESTIONS[1],
        SUGGESTIONS[2],
        `Who replied about ${me.companies.find((c) => /ivy/i.test(c)) || me.companies[0]}?`,
      ]
    : SUGGESTIONS;
  $("#chips").replaceChildren(
    ...chips.map((q) => h("button", { type: "button", class: "chip" }, q)),
  );
  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (b) ask(b.textContent);
  });
  $("#ask").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#q").value.trim();
    if (q) ask(q);
  });
  // Open on the answer, not on an empty box: the week's summary loads first,
  // the same as pressing the first chip.
  ask(chips[0]);
}

function setSync(online) {
  const el = $("#sync");
  el.className = `sync ${online ? "on" : "off"}`;
  el.lastChild.textContent = online ? "Live" : "Reconnecting";
}

function ask(q) {
  if (current) current.close();
  $("#q").value = "";
  $("#empty").hidden = true;
  const turn = h(
    "div",
    { class: "turn" },
    h("div", { class: "question" }, q),
    h(
      "div",
      { class: "status" },
      h("span", { class: "spinner", "aria-hidden": "true" }),
      h("span", {}, "Thinking"),
    ),
    h("div", { class: "answer" }),
  );
  $("#feed").prepend(turn);
  turn.scrollIntoView({ behavior: "smooth", block: "start" });
  const status = turn.querySelector(".status");
  const answer = turn.querySelector(".answer");
  const slots = [];
  const es = new EventSource(`/api/ask?q=${encodeURIComponent(q)}`);
  current = es;
  const finish = () => {
    es.close();
    status.remove();
    for (const s of slots)
      if (s && s.classList.contains("skeleton")) s.remove();
  };
  es.addEventListener("status", (e) => {
    status.lastChild.textContent = JSON.parse(e.data).text;
  });
  es.addEventListener("plan", (e) => {
    const { slots: plan } = JSON.parse(e.data);
    for (const s of plan) {
      const sk = h(
        "section",
        {
          class: `block skeleton${s.view === "say" || s.view === "stats_headline" ? " bare" : ""}`,
        },
        s.title ? h("h3", {}, s.title) : null,
        h("div", { class: "shimmer" }),
        h("div", { class: "shimmer short" }),
      );
      slots[s.at] = sk;
      answer.append(sk);
    }
  });
  es.addEventListener("block", (e) => {
    const { at, block } = JSON.parse(e.data);
    const el = renderBlock(h, block);
    if (!el) return;
    el.classList.add("enter");
    if (slots[at]) slots[at].replaceWith(el);
    else answer.append(el);
    slots[at] = el;
    requestAnimationFrame(() => el.classList.add("in"));
    if (block.source === "clay")
      setSync(!block.stale || block.stale.refreshing);
  });
  let done = false;
  es.addEventListener("done", () => {
    done = true;
    finish();
  });
  // Any error before "done" gets a visible notice: a refusal from the server
  // carries its reason, a dropped connection gets the generic one.
  es.addEventListener("error", (e) => {
    if (done) return;
    done = true;
    let text = "The connection dropped before the answer finished. Ask again.";
    let code = 0;
    if (e.data) {
      try {
        ({ text, code = 0 } = JSON.parse(e.data));
      } catch (err) {
        console.error("unreadable error event", err);
      }
    }
    const note = h("div", { class: "notice warn", role: "alert" }, text);
    if (code !== 401) {
      const retry = h(
        "button",
        { type: "button", class: "retry" },
        "Try again",
      );
      retry.addEventListener("click", () => ask(q));
      note.append(" ", retry);
    }
    answer.append(note);
    finish();
  });
}

boot().catch(() => {
  $("#feed").replaceChildren(
    h(
      "div",
      { class: "notice warn" },
      "This page could not load. Refresh to try again.",
    ),
  );
});
