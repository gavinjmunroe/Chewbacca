/* Shared chrome for every page outside the home page: the header, the hiring
   banner, the footer and the cookie card, plus the behaviour every page
   shares (banner dismiss, cookie choice, Weekly sign-up, copy link).

   The header and banner markup is the home page's, class for class, so the
   same rules in styles.css, chrome.css and states.css paint it. The footer is
   not copied at all: it is lower.js's own renderFooter(), so a change the home
   page's writer makes to the footer lands on every page without a second
   edit here.

   Links are built against the repo root, found from this file's own URL, so
   one module serves pages/x.html, pages/blog/y.html and the root 404.html
   without each page carrying a prefix. */
import { renderFooter } from "../sections/lower.js";
import { drawFigures } from "./figures.js";
import { wirePage } from "./behaviour.js";

const ROOT = new URL("../../", import.meta.url);

export const ROUTES = {
  home: "index.html",
  docs: "pages/docs.html",
  blog: "pages/blog.html",
  weekly: "pages/weekly.html",
  changelog: "pages/changelog.html",
  careers: "pages/careers.html",
  trust: "pages/trust.html",
  status: "pages/trust.html#status",
  about: "pages/blog/introducing-sift.html",
  login: "pages/login.html",
  demo: "pages/demo.html",
};

export const route = (key) => new URL(ROUTES[key], ROOT).href;

/* The footer as lower.js writes it carries "#" placeholders until the lead
   applies real hrefs (docs/spec/pages.md lists them). Map by visible label
   meanwhile; once a real relative href is there, resolve it against the root
   instead, so "pages/blog.html" written for index.html also works from
   pages/blog/x.html. */
const FOOTER_LABELS = {
  Docs: "docs",
  Blog: "blog",
  Weekly: "weekly",
  Changelog: "changelog",
  Careers: "careers",
  "Trust center": "trust",
  About: "about",
  Status: "status",
};

const MARK = `
  <svg viewBox="0 0 22 20" width="19" height="17" aria-hidden="true">
    <path d="M11 1 1 6l10 5 10-5z" fill="#1d1956"/>
    <path d="M1 10.5 11 15.5 21 10.5" fill="none" stroke="#755cfe" stroke-width="1.6"/>
    <path d="M1 14.5 11 19.5 21 14.5" fill="none" stroke="#755cfe" stroke-width="1.6" opacity=".55"/>
  </svg>`;

const NAV = [
  ["Docs", "docs"],
  ["Blog", "blog"],
  ["Weekly", "weekly"],
  ["Changelog", "changelog"],
  ["Careers", "careers"],
];

function headerHtml(current) {
  const links = NAV.map(([label, key]) => {
    const cur = key === current ? ' aria-current="page"' : "";
    return `<a href="${route(key)}" class="ul-grow"${cur}>${label}</a>`;
  }).join("");
  return `
<header class="header">
  <div class="inner">
    <a class="brand" href="${route("home")}">${MARK}<span>Sift</span></a>
    <nav class="nav" aria-label="Primary">${links}</nav>
    <div class="right">
      <a class="btn btn-ghost" href="${route("login")}">Login</a>
      <a class="btn btn-primary" href="${route("demo")}">Book a demo</a>
    </div>
  </div>
</header>
<div class="banner">
  <span class="bmark" aria-hidden="true"></span>
  We're&nbsp;<a href="${route("careers")}">hiring</a>!
  <button class="bclose" type="button" aria-label="Dismiss">&times;</button>
</div>`;
}

/* Same words as the card in index.html, so the choice reads the same
   wherever it is made. */
const COOKIE_HTML = `
<aside class="cc" id="cookie-card" role="dialog" aria-labelledby="cc-h" aria-describedby="cc-b">
  <div class="cc-head" id="cc-h">Cookies</div>
  <p class="cc-body" id="cc-b">One analytics cookie, to see which parts get read.</p>
  <div class="cc-actions">
    <button class="cc-btn" type="button" data-cc="reject">Reject</button>
    <button class="cc-btn" type="button" data-cc="choose">Choose</button>
    <button class="cc-btn cc-btn-primary" type="button" data-cc="accept">Accept</button>
  </div>
</aside>`;

/* Storage can throw in a private window. Every read and write goes through
   these, and a failure means "show the thing", never a broken page. */
function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* nothing to keep it in */
  }
}

const BANNER_KEY = "sift.banner-dismissed";
const COOKIE_KEY = "sift.cookie-choice";

/* Theirs stays dismissed across a reload (checked 2026-10-03: reload, no
   banner). Removing the node rather than hiding it, because chrome.css sets
   `display: block` on `body .banner` and that beats the [hidden] attribute. */
export function wireBanner(doc = document) {
  const banner = doc.querySelector(".banner");
  if (!banner) return;
  const off = () => {
    banner.remove();
    doc.documentElement.classList.add("is-banner-off");
    doc.documentElement.style.setProperty("--banner-h", "0px");
  };
  /* Their /careers renders no banner: it would only link to the page it is
     on. A page opts out with data-banner="none", without storing anything. */
  if (load(BANNER_KEY) || doc.body.dataset.banner === "none") {
    off();
    return;
  }
  banner.querySelector(".bclose")?.addEventListener("click", () => {
    save(BANNER_KEY, "1");
    off();
  });
}

function wireCookieCard(doc = document) {
  const card = doc.getElementById("cookie-card");
  if (!card) return;
  doc.addEventListener("sift:cookie-settings", () => {
    card.hidden = false;
  });
  if (load(COOKIE_KEY)) card.hidden = true;
  card.addEventListener("click", (e) => {
    const choice = e.target.closest("[data-cc]")?.dataset.cc;
    if (!choice) return;
    save(COOKIE_KEY, choice);
    card.hidden = true;
  });
}

function fixFooterLinks(foot) {
  for (const a of foot.querySelectorAll("a[href]")) {
    const raw = a.getAttribute("href");
    const label = a.textContent.trim();
    if (raw.startsWith("mailto:") || /^[a-z]+:\/\//i.test(raw)) continue;
    if (raw.startsWith("#")) {
      const key =
        FOOTER_LABELS[label] ||
        (a.classList.contains("lw-foot-logo") ? "home" : null);
      a.href = key ? route(key) : new URL(ROUTES.home + raw, ROOT).href;
    } else {
      a.href = new URL(raw, ROOT).href;
    }
  }
}

/* ---- Weekly sign-up --------------------------------------------------- */
/* Their form, read from app/weekly/page-*.js: novalidate, an empty check,
   then /^[^\s@]+@[^\s@]+\.[^\s@]+$/, aria-invalid on the input, a status
   paragraph wired by aria-describedby, and focus moved to that paragraph on
   error or success. Theirs then POSTs; ours stops at success and sends
   nothing anywhere. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let statusSeq = 0;

export function wireNewsletter(form, status) {
  if (!form || form.dataset.wired) return;
  form.dataset.wired = "1";
  form.noValidate = true;
  const input = form.querySelector('input[type="email"]');
  const button = form.querySelector(
    'button[type="submit"], button:not([type])',
  );
  if (!input || !button) return;
  if (!status.id) status.id = `pg-status-${++statusSeq}`;
  status.setAttribute("aria-live", "polite");
  status.tabIndex = -1;
  input.setAttribute("aria-describedby", status.id);
  const idle = status.textContent;
  const label = button.textContent;

  const say = (text, tone) => {
    status.textContent = text;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
    /* The home page does not load pages.css, so the tone colour is also set
       directly. Cleared when there is no tone. */
    status.style.color =
      tone === "error" ? "#c2334d" : tone === "ok" ? "#2f7d5b" : "";
  };

  input.addEventListener("input", () => {
    if (input.getAttribute("aria-invalid") === "true") {
      input.removeAttribute("aria-invalid");
      say(idle, null);
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();
    let problem = "";
    if (!value) problem = "Type your work email first.";
    else if (!EMAIL.test(value))
      problem = "That address is missing a part. Try name@company.com.";
    if (problem) {
      input.setAttribute("aria-invalid", "true");
      say(problem, "error");
      status.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    button.disabled = true;
    input.disabled = true;
    button.textContent = "Adding you";
    /* No request is made. The pause stands in for the round trip so the
       pending state is visible, and is under their 400ms feedback budget. */
    setTimeout(() => {
      form.style.display = "none";
      say(`You're on the list as ${value}. The next issue lands Friday.`, "ok");
      status.focus();
      button.textContent = label;
    }, 350);
  });
}

/* ---- copy link -------------------------------------------------------- */
/* Theirs: clipboard.writeText(location.href), "Copied!" for 2000ms. */
function wireCopyLinks(doc = document) {
  for (const btn of doc.querySelectorAll("[data-copy-link]")) {
    const text = btn.querySelector("[data-label]") || btn;
    const idle = text.textContent;
    let timer = 0;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        text.textContent = "Copied";
      } catch {
        text.textContent = "Copy failed";
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        text.textContent = idle;
      }, 2000);
    });
  }
}

/* ---- mount ------------------------------------------------------------ */
export function mountChrome(doc = document) {
  const current = doc.body.dataset.nav || "";
  const head = doc.getElementById("site-chrome");
  if (head) head.innerHTML = headerHtml(current);

  let foot = doc.getElementById("lower-footer");
  if (foot) {
    foot.innerHTML = renderFooter();
    fixFooterLinks(foot);
    foot
      .querySelector(".lw-cookie-btn")
      ?.addEventListener("click", () =>
        doc.dispatchEvent(new CustomEvent("sift:cookie-settings")),
      );
  }
  if (!doc.getElementById("cookie-card"))
    doc.body.insertAdjacentHTML("beforeend", COOKIE_HTML);

  wireBanner(doc);
  wireCookieCard(doc);
  for (const form of doc.querySelectorAll("form[data-newsletter]")) {
    const status = form.parentElement.querySelector("[data-status]");
    if (status) wireNewsletter(form, status);
  }
  wireCopyLinks(doc);
  drawFigures(doc);
  wirePage(doc);
}

if (document.body.dataset.chrome !== "none") mountChrome();
