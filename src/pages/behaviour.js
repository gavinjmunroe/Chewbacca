/* Per-page behaviour, each piece keyed off a data attribute so a page opts
   in by markup and nothing runs where its hooks are absent. */

/* ---- list filters ----------------------------------------------------- */
/* Their blog index, app/blog/page-*.js: a category button row plus a title
   search, both applied together, case-insensitive, and "No articles found."
   when nothing survives. One filter serves the blog and the changelog: rows
   carry data-cat (space separated) and data-title. */
function wireFilter(root) {
  const list = root.querySelector("[data-filter-list]");
  if (!list) return;
  const chips = [...root.querySelectorAll("[data-filter]")];
  const search = root.querySelector("[data-search]");
  const empty = root.querySelector("[data-empty]");
  const rows = [...list.querySelectorAll("[data-cat]")];
  let cat = "all";

  const apply = () => {
    const q = (search?.value || "").trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const inCat = cat === "all" || row.dataset.cat.split(" ").includes(cat);
      const inQ =
        !q || (row.dataset.title || row.textContent).toLowerCase().includes(q);
      row.hidden = !(inCat && inQ);
      if (!row.hidden) shown++;
    }
    if (empty) empty.hidden = shown > 0;
  };

  for (const chip of chips) {
    chip.addEventListener("click", () => {
      cat = chip.dataset.filter;
      for (const c of chips) c.setAttribute("aria-pressed", String(c === chip));
      apply();
    });
  }
  search?.addEventListener("input", apply);
  apply();
}

/* ---- tabs ------------------------------------------------------------- */
/* The trust center's three views. Arrow keys move between tabs, as the
   ARIA tabs pattern expects, and a #hash naming a panel opens it. */
function wireTabs(root) {
  const list = root.querySelector('[role="tablist"]');
  if (!list) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const show = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      root.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => show(tab, false));
    tab.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      show(tabs[(i + step + tabs.length) % tabs.length], true);
    });
  });
  const fromHash = tabs.find(
    (t) => `#${t.getAttribute("aria-controls")}` === location.hash,
  );
  show(fromHash || tabs[0], false);
}

/* ---- contents rail ---------------------------------------------------- */
/* Marks the section nearest the top of the reading area. */
function wireToc(root) {
  const toc = root.querySelector("[data-toc]");
  if (!toc) return;
  const links = [...toc.querySelectorAll('a[href^="#"]')];
  const heads = links
    .map((a) => root.getElementById(a.getAttribute("href").slice(1)))
    .filter(Boolean);
  if (!heads.length) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const line = 160;
    let cur = heads[0];
    for (const h of heads) if (h.getBoundingClientRect().top <= line) cur = h;
    for (const a of links)
      a.setAttribute(
        "aria-current",
        String(a.getAttribute("href") === `#${cur.id}`),
      );
  };
  addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  update();
}

/* ---- forms with a success panel -------------------------------------- */
/* The demo request and the sign-in link. Validate every field in place,
   name the problem next to the field, move focus to the first bad one, and
   on success swap the form for a confirmation that repeats back what was
   entered. Nothing is sent anywhere. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|icloud|proton)\./i;

function check(field) {
  const v = field.value.trim();
  const name = field.dataset.label || field.name;
  if (field.required && !v) return `Add your ${name}.`;
  if (field.type === "email" && v && !EMAIL.test(v))
    return "That address is missing a part. Try name@company.com.";
  if (field.dataset.work && v && FREE_MAIL.test(v))
    return "Use your work address so we can find your team.";
  if (field.minLength > 0 && v && v.length < field.minLength)
    return `A little more here, at least ${field.minLength} characters.`;
  return "";
}

function wireForm(form) {
  const done = form.ownerDocument.getElementById(form.dataset.done);
  const fields = [...form.querySelectorAll("input, select, textarea")];
  const button = form.querySelector('button[type="submit"]');
  form.noValidate = true;

  const errFor = (f) => form.querySelector(`#${f.id}-err`);
  const mark = (f, msg) => {
    const err = errFor(f);
    if (err) err.textContent = msg;
    if (msg) f.setAttribute("aria-invalid", "true");
    else f.removeAttribute("aria-invalid");
  };
  for (const f of fields) {
    const err = errFor(f);
    if (err) f.setAttribute("aria-describedby", err.id);
    f.addEventListener("blur", () => {
      if (f.value) mark(f, check(f));
    });
    f.addEventListener("input", () => {
      if (f.getAttribute("aria-invalid")) mark(f, check(f));
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    let first = null;
    for (const f of fields) {
      const msg = check(f);
      mark(f, msg);
      if (msg && !first) first = f;
    }
    if (first) {
      first.focus();
      return;
    }
    const label = button.textContent;
    button.disabled = true;
    button.textContent = form.dataset.pending || "Sending";
    setTimeout(() => {
      form.hidden = true;
      if (done) {
        for (const slot of done.querySelectorAll("[data-echo]")) {
          const src = form.querySelector(`[name="${slot.dataset.echo}"]`);
          if (src) slot.textContent = src.value.trim();
        }
        done.hidden = false;
        done.focus();
      }
      button.disabled = false;
      button.textContent = label;
    }, 450);
  });

  done?.querySelector("[data-reset]")?.addEventListener("click", () => {
    form.reset();
    done.hidden = true;
    form.hidden = false;
    fields[0]?.focus();
  });
}

export function wirePage(doc = document) {
  wireFilter(doc);
  wireTabs(doc);
  wireToc(doc);
  for (const form of doc.querySelectorAll("form[data-done]")) wireForm(form);
}
