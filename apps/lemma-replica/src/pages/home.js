/* The two home page controls that had no behaviour: the banner's dismiss
   and the Weekly sign-up in the lower section. Same code as every other
   page, imported from chrome.js; index.html sets data-chrome="none" so
   chrome.js does not also render its own header and footer here.

   The sign-up form is written by lower.js, which mounts from app.js. Module
   scripts run in document order, so it normally exists already; if that
   ever changes, wait for it rather than silently wiring nothing. */
import { wireBanner, wireNewsletter } from "./chrome.js";

wireBanner(document);

function wireHomeForm() {
  const form = document.querySelector("#lower .lw-form");
  const note = document.querySelector("#lower .lw-sub-note");
  if (!form || !note) return false;
  wireNewsletter(form, note);
  return true;
}

if (!wireHomeForm()) {
  const lower = document.getElementById("lower");
  if (lower) {
    const mo = new MutationObserver(() => {
      if (wireHomeForm()) mo.disconnect();
    });
    mo.observe(lower, { childList: true, subtree: true });
  }
}
