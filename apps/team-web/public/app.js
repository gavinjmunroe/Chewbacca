// Board client. Every string from a task goes into the page through
// textContent, never innerHTML: titles, comments and notes are typed by
// teammates and commits, and the only markup set by string is the fixed icons.
const BOARD_COLUMNS = ["backlog", "todo", "in_progress", "in_review", "done"];
const LIST_ORDER = [
  "in_progress",
  "in_review",
  "todo",
  "backlog",
  "inbox",
  "done",
  "canceled",
];
const LABEL = {
  inbox: "Inbox",
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  canceled: "Canceled",
};
const PRIORITY_LABEL = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};
// Inbox items imported from BACKLOG.md carry their section as a label; grouping
// by it keeps a 130-item inbox scannable instead of one undifferentiated wall.
const INBOX_GROUPS = [
  ["os", "OS handoff"],
  ["now", "Now"],
  ["next", "Next"],
  ["verify", "Verification gaps"],
  ["blocked", "Blocked"],
  ["deferred", "Deferred"],
];
// 10s keeps a CLI edit visible on the board before anyone notices a lag, and
// costs one GitHub listing call per open tab per poll: 360 an hour, well inside
// the 5,000 an hour each signed-in token gets.
const POLL_MS = 10000;

const ICON = {
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 10 10" fill="currentColor"><path d="M1 3h8L5 8z"/></svg>',
  inbox:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2 9l2-6h8l2 6v4H2z"/><path d="M2 9h3.5l1 1.5h3L10.5 9H14"/></svg>',
  me: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="6" r="2.6"/><path d="M3 13.5c.8-2.4 2.7-3.5 5-3.5s4.2 1.1 5 3.5" stroke-linecap="round"/></svg>',
  list: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 4h10M3 8h10M3 12h10"/></svg>',
  board:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="3.5" height="10" rx="1"/><rect x="6.25" y="3" width="3.5" height="7" rx="1"/><rect x="10.5" y="3" width="3.5" height="5" rx="1"/></svg>',
  pulse:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8h3l2-4.5 3 9 2-4.5h3"/></svg>',
  github:
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 .3a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.4c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.5 1.1.2 1.9.1 2.1.5.5.8 1.2.8 2.1 0 3.1-1.9 3.8-3.6 4 .3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 .3Z"/></svg>',
};

function statusIcon(status) {
  const s = '<svg viewBox="0 0 14 14" width="14" height="14" fill="none">';
  const ring = (color, dash = "") =>
    `<circle cx="7" cy="7" r="5.5" stroke="${color}" stroke-width="1.5" ${dash}/>`;
  const map = {
    inbox: `${s}${ring("#62666d", 'stroke-dasharray="1.6 1.6"')}</svg>`,
    backlog: `${s}${ring("#8a8f98", 'stroke-dasharray="2.2 1.6"')}</svg>`,
    todo: `${s}${ring("#d0d6e0")}</svg>`,
    in_progress: `${s}${ring("#f2c94c")}<path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="#f2c94c"/></svg>`,
    in_review: `${s}${ring("#4cb782")}<path d="M7 3.5a3.5 3.5 0 1 1-3.5 3.5H7z" fill="#4cb782"/></svg>`,
    done: `${s}<circle cx="7" cy="7" r="6.25" fill="#5e6ad2"/><path d="M4.4 7.2l1.8 1.8 3.5-3.6" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    canceled: `${s}<circle cx="7" cy="7" r="6.25" fill="#62666d"/><path d="M5 5l4 4M9 5L5 9" stroke="#0f1011" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  };
  return map[status] || map.todo;
}

function priorityIcon(p) {
  if (p === "urgent")
    return '<svg viewBox="0 0 14 14" width="14" height="14"><rect x="1" y="1" width="12" height="12" rx="3" fill="#eb5757"/><path d="M7 4v3.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="7" cy="10" r=".9" fill="#fff"/></svg>';
  const on = { high: 3, medium: 2, low: 1 }[p] || 0;
  if (!on)
    return '<svg viewBox="0 0 14 14" width="14" height="14"><path d="M2.5 7h2M6 7h2M9.5 7h2" stroke="#62666d" stroke-width="1.4" stroke-linecap="round"/></svg>';
  const bar = (i, h) =>
    `<rect x="${1.5 + i * 4}" y="${12 - h}" width="3" height="${h}" rx="1" fill="${i < on ? "#d0d6e0" : "#34343a"}"/>`;
  return `<svg viewBox="0 0 14 14" width="14" height="14">${bar(0, 4)}${bar(1, 7)}${bar(2, 10)}</svg>`;
}

const state = {
  me: null,
  board: null,
  view: "inbox",
  person: null,
  label: null,
  query: "",
  layout: "list",
  feedOpen: false,
  feed: [],
  openId: null,
  dirty: false,
  error: null,
  synced: true,
  closed: {},
};
try {
  state.layout = localStorage.getItem("team.layout") || "list";
  state.closed = JSON.parse(localStorage.getItem("team.closed") || "{}");
} catch {
  /* private mode: defaults are fine */
}
const app = document.getElementById("app");

// ---------- helpers ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "icon") {
      if (Object.hasOwn(ICON, v))
        node.insertAdjacentHTML("afterbegin", ICON[v]);
    } else if (k === "svg") node.insertAdjacentHTML("afterbegin", v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "value") node.value = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat())
    if (c !== null && c !== undefined && c !== false)
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

function save(key, value) {
  try {
    localStorage.setItem(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  } catch {
    /* private mode */
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Team-Request": "1",
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    state.me = null;
    render();
    throw new Error("signed out");
  }
  if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
  return body;
}

let toastTimer;
function toast(message, isError = false) {
  const t = document.getElementById("toast");
  t.textContent = message;
  t.className = `toast${isError ? " err" : ""}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, 3000);
}

function member(name) {
  return state.board?.members.find((m) => m.name === name);
}

function avatar(name) {
  if (!name) return el("span", { class: "avatar none", title: "Unassigned" });
  const gh = member(name)?.github;
  if (gh)
    return el(
      "span",
      { class: "avatar", title: name },
      el("img", {
        src: `https://avatars.githubusercontent.com/${encodeURIComponent(gh)}?size=40`,
        alt: "",
      }),
    );
  return el(
    "span",
    { class: "avatar", title: name },
    name.slice(0, 1).toUpperCase(),
  );
}

function dueText(task) {
  if (!task.due) return null;
  const closed = task.status === "done" || task.status === "canceled";
  const late = !closed && task.due < state.board.today;
  const label = new Date(`${task.due}T00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return el(
    "span",
    { class: `due${late ? " late" : ""}`, title: late ? "Overdue" : "Due" },
    label,
  );
}

function labelPill(l) {
  return el("span", { class: "label" }, el("i"), l);
}

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function inView(t, { ignoreLabel = false } = {}) {
  if (state.view === "inbox" && t.status !== "inbox") return false;
  if (
    state.view === "mine" &&
    (t.owner !== state.me.member || t.status === "canceled")
  )
    return false;
  if (
    state.view === "active" &&
    !["todo", "in_progress", "in_review"].includes(t.status)
  )
    return false;
  if (state.view === "person" && t.owner !== state.person) return false;
  if (state.view !== "inbox" && t.status === "inbox" && state.view !== "all")
    return false;
  if (!ignoreLabel && state.label && !t.labels.includes(state.label)) return false;
  const q = state.query.trim().toLowerCase();
  if (
    q &&
    !`${t.id} ${t.title} ${t.owner} ${t.labels.join(" ")} ${t.source}`
      .toLowerCase()
      .includes(q)
  )
    return false;
  return true;
}

function viewTitle() {
  return {
    inbox: "Inbox",
    mine: "My tasks",
    active: "Active",
    all: "All tasks",
    person: state.person,
  }[state.view];
}

// ---------- data ----------

async function loadBoard() {
  try {
    const board = await api("/api/board");
    const changed = !state.board || board.version !== state.board.version;
    state.board = board;
    state.error = null;
    state.synced = true;
    if (changed) render();
    else renderSync();
  } catch (err) {
    if (err.message === "signed out") return;
    state.synced = false;
    if (!state.board) {
      state.error = err.message;
      render();
    } else renderSync();
  }
}

async function loadFeed() {
  try {
    state.feed = await api("/api/feed");
  } catch {
    state.feed = [];
  }
  if (state.feedOpen) renderFeed();
}

async function patch(id, changes) {
  const task = state.board.tasks.find((t) => t.id === id);
  const before = { ...task };
  Object.assign(task, changes);
  render();
  try {
    Object.assign(
      task,
      await api(`/api/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      }),
    );
    state.board.version = "local";
    render();
    loadFeed();
    return true;
  } catch (err) {
    Object.assign(task, before);
    render();
    toast(err.message, true);
    return false;
  }
}

// ---------- shell ----------

function render() {
  if (!state.me) return renderSignIn();
  if (!state.board) {
    app.replaceChildren(
      el(
        "div",
        { class: "boot" },
        state.error ? errorBanner() : "Loading the board",
      ),
    );
    return;
  }
  app.replaceChildren(
    el(
      "div",
      { class: "shell" },
      sidebar(),
      el(
        "main",
        { class: "main" },
        mobileNav(),
        topBar(),
        labelChips(),
        body(),
      ),
    ),
  );
  if (state.feedOpen) document.body.append(feedPanel());
  else document.getElementById("feed")?.remove();
  if (state.openId) renderDrawer();
}

function renderSignIn() {
  app.replaceChildren(
    el(
      "main",
      { class: "signin" },
      el(
        "div",
        { class: "signin-box" },
        el("div", { class: "word" }, "Chewbacca"),
        el("h1", {}, "Team board"),
        el(
          "p",
          {},
          "Every task is a file in the Chewbacca repo. The team CLI and this page read the same files, so a change in one shows up in the other.",
        ),
        el(
          "a",
          { class: "btn btn-inverse", href: "/auth/login", icon: "github" },
          "Continue with GitHub",
        ),
        el("p", { class: "fine" }, "For anyone with write access to the repo."),
      ),
    ),
  );
}

function go(view, extra = {}) {
  Object.assign(state, { view, person: null, label: null }, extra);
  render();
}

function sidebar() {
  const tasks = state.board.tasks;
  const count = (fn) => tasks.filter(fn).length;
  const open = (t) => !["done", "canceled", "inbox"].includes(t.status);
  const nav = (key, icon, label, n, extra) =>
    el(
      "button",
      {
        class: `nav${state.view === key && (!extra || state.person === extra.person) ? " on" : ""}`,
        onclick: () => go(key, extra),
      },
      icon instanceof Node ? icon : el("span", { svg: ICON[icon] }),
      el("span", {}, label),
      n ? el("span", { class: "n" }, String(n)) : null,
    );
  return el(
    "aside",
    { class: "side" },
    el(
      "div",
      { class: "ws" },
      el("span", { class: "ws-mark" }, "C"),
      "Chewbacca",
    ),
    nav(
      "inbox",
      "inbox",
      "Inbox",
      count((t) => t.status === "inbox"),
    ),
    nav(
      "mine",
      "me",
      "My tasks",
      count((t) => t.owner === state.me.member && open(t)),
    ),
    el("div", { class: "nav-label" }, "Team"),
    nav(
      "active",
      "board",
      "Active",
      count((t) => ["todo", "in_progress", "in_review"].includes(t.status)),
    ),
    nav("all", "list", "All tasks", tasks.length),
    el("div", { class: "nav-label" }, "People"),
    ...state.board.members.map((m) =>
      nav(
        "person",
        avatar(m.name),
        m.name,
        count((t) => t.owner === m.name && open(t)),
        { person: m.name },
      ),
    ),
    el(
      "div",
      { class: "side-foot" },
      avatar(state.me.member),
      el("span", { class: "who" }, state.me.member),
      el("button", { class: "btn btn-ghost", onclick: signOut }, "Sign out"),
    ),
  );
}

function mobileNav() {
  const chip = (key, label) =>
    el(
      "button",
      {
        class: `chip${state.view === key ? " on" : ""}`,
        onclick: () => go(key),
      },
      label,
    );
  return el(
    "nav",
    { class: "mnav" },
    chip("inbox", "Inbox"),
    chip("mine", "Mine"),
    chip("active", "Active"),
    chip("all", "All"),
  );
}

function topBar() {
  const shown = state.board.tasks.filter(inView).length;
  const search = el("input", {
    class: "search",
    type: "search",
    placeholder: "Search",
    "aria-label": "Search tasks",
    value: state.query,
    oninput: (e) => {
      state.query = e.target.value;
      document.getElementById("body").replaceWith(body());
    },
  });
  search.id = "search";
  const layoutBtn = (key, icon, label) =>
    el("button", {
      class: `btn btn-ghost icon-btn${state.layout === key ? " on" : ""}`,
      icon,
      title: label,
      "aria-label": label,
      "aria-pressed": String(state.layout === key),
      onclick: () => {
        state.layout = key;
        save("team.layout", key);
        render();
      },
    });
  return el(
    "header",
    { class: "bar" },
    el(
      "h1",
      {},
      viewTitle(),
      " ",
      el("span", { class: "count" }, String(shown)),
    ),
    el("span", { class: "spacer" }),
    state.synced
      ? null
      : el("span", { class: "sync-off", id: "sync" }, "Reconnecting"),
    search,
    state.view === "inbox" ? null : layoutBtn("list", "list", "List"),
    state.view === "inbox" ? null : layoutBtn("board", "board", "Board"),
    el("button", {
      class: "btn btn-ghost icon-btn",
      icon: "pulse",
      title: "Recent activity",
      "aria-label": "Recent activity",
      onclick: () => {
        state.feedOpen = !state.feedOpen;
        render();
        if (state.feedOpen) loadFeed();
      },
    }),
    el(
      "button",
      {
        class: "btn btn-primary",
        icon: "plus",
        title: "New task (C)",
        onclick: () => openCreate(),
      },
      "New task",
    ),
  );
}

function labelChips() {
  const pool = state.board.tasks.filter((t) => inView(t, { ignoreLabel: true }));
  const counts = {};
  for (const t of pool)
    for (const l of t.labels) counts[l] = (counts[l] || 0) + 1;
  const labels = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 9);
  if (!labels.length) return null;
  return el(
    "div",
    { class: "chips" },
    el(
      "button",
      {
        class: `chip${!state.label ? " on" : ""}`,
        onclick: () => {
          state.label = null;
          render();
        },
      },
      "All",
    ),
    ...labels.map(([l, n]) =>
      el(
        "button",
        {
          class: `chip${state.label === l ? " on" : ""}`,
          onclick: () => {
            state.label = state.label === l ? null : l;
            render();
          },
        },
        l,
        el("span", { class: "n" }, String(n)),
      ),
    ),
  );
}

function body() {
  const tasks = state.board.tasks.filter(inView);
  const node =
    state.layout === "board" && state.view !== "inbox"
      ? boardView(tasks)
      : listView(tasks);
  node.id = "body";
  return node;
}

// ---------- list ----------

function listView(tasks) {
  const wrap = el("section", { "aria-label": "Tasks" });
  if (!tasks.length) {
    wrap.append(
      el(
        "div",
        { class: "empty-state" },
        el("h2", {}, state.view === "inbox" ? "Inbox zero" : "Nothing here"),
        el(
          "p",
          {},
          state.view === "inbox"
            ? "Every imported item has been triaged into the team's statuses."
            : "No tasks match this view.",
        ),
        el(
          "button",
          { class: "btn", icon: "plus", onclick: () => openCreate() },
          "New task",
        ),
      ),
    );
    return wrap;
  }
  const groups =
    state.view === "inbox"
      ? [
          ...INBOX_GROUPS.map(([key, name]) => [
            `inbox:${key}`,
            name,
            tasks.filter(
              (t) =>
                t.labels.includes(key) &&
                !INBOX_GROUPS.slice(
                  0,
                  INBOX_GROUPS.findIndex((g) => g[0] === key),
                ).some(([k]) => t.labels.includes(k)),
            ),
          ]),
          [
            "inbox:other",
            "Other",
            tasks.filter(
              (t) => !INBOX_GROUPS.some(([k]) => t.labels.includes(k)),
            ),
          ],
        ]
      : LIST_ORDER.map((s) => [
          s,
          LABEL[s],
          tasks.filter((t) => t.status === s),
        ]);
  for (const [key, name, items] of groups) {
    if (!items.length) continue;
    const closed = !!state.closed[key];
    const status = key.startsWith("inbox") ? "inbox" : key;
    wrap.append(
      el(
        "button",
        {
          class: `group-head${closed ? " closed" : ""}`,
          "aria-expanded": String(!closed),
          onclick: () => {
            state.closed[key] = !closed;
            save("team.closed", state.closed);
            render();
          },
        },
        el("span", { svg: ICON.chev }),
        el("span", { svg: statusIcon(status) }),
        name,
        el("span", { class: "n" }, String(items.length)),
      ),
    );
    if (!closed) wrap.append(...items.map(row));
  }
  return wrap;
}

function row(t) {
  return el(
    "button",
    {
      class: `row${["done", "canceled"].includes(t.status) ? " closed" : ""}`,
      "aria-label": `${t.id} ${t.title}`,
      onclick: () => openTask(t.id),
    },
    el("span", {
      svg: priorityIcon(t.priority),
      title: PRIORITY_LABEL[t.priority || "none"],
    }),
    el("span", { class: "id" }, t.id),
    el("span", { svg: statusIcon(t.status), title: LABEL[t.status] }),
    el("span", { class: "title" }, t.title),
    el(
      "span",
      { class: "meta" },
      ...t.labels
        .filter((l) => l !== "backlog")
        .slice(0, 2)
        .map(labelPill),
    ),
    dueText(t) || el("span"),
    avatar(t.owner),
  );
}

// ---------- board ----------

function boardView(tasks) {
  const board = el("section", { class: "board", "aria-label": "Task board" });
  for (const status of BOARD_COLUMNS) {
    const items = tasks.filter((t) => t.status === status);
    const col = el(
      "div",
      { class: "col", "data-status": status },
      el(
        "div",
        { class: "col-head" },
        el("span", { svg: statusIcon(status) }),
        LABEL[status],
        el("span", { class: "n" }, String(items.length)),
      ),
      el(
        "div",
        { class: "cards" },
        items.length
          ? items.map(card)
          : el("div", { class: "col-empty" }, "No tasks"),
      ),
    );
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("drop");
    });
    col.addEventListener("dragleave", () => col.classList.remove("drop"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drop");
      const task = state.board.tasks.find(
        (t) => t.id === e.dataTransfer.getData("text/plain"),
      );
      if (!task || task.status === status) return;
      if (status === "done" && !task.proof) {
        openTask(task.id, { askProof: true });
        return;
      }
      patch(task.id, { status });
    });
    board.append(col);
  }
  return board;
}

function card(t) {
  const c = el(
    "button",
    {
      class: "card",
      draggable: "true",
      "aria-label": `${t.id} ${t.title}`,
      onclick: () => openTask(t.id),
    },
    el(
      "div",
      { class: "top" },
      el("span", { svg: priorityIcon(t.priority) }),
      t.id,
      avatar(t.owner),
    ),
    el("div", { class: "title" }, t.title),
    t.labels.length || t.due
      ? el(
          "div",
          { class: "meta" },
          dueText(t),
          ...t.labels
            .filter((l) => l !== "backlog")
            .slice(0, 2)
            .map(labelPill),
        )
      : null,
  );
  c.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", t.id);
    c.classList.add("dragging");
  });
  c.addEventListener("dragend", () => c.classList.remove("dragging"));
  return c;
}

function errorBanner() {
  return el(
    "div",
    { class: "banner", role: "alert" },
    el("p", {}, `Couldn't load the board: ${state.error}`),
    el(
      "button",
      {
        class: "btn",
        onclick: () => {
          state.error = null;
          render();
          loadBoard();
        },
      },
      "Try again",
    ),
  );
}

function renderSync() {
  const bar = document.querySelector(".bar");
  const s = document.getElementById("sync");
  if (state.synced) s?.remove();
  else if (bar && !s)
    bar
      .querySelector(".spacer")
      .after(el("span", { class: "sync-off", id: "sync" }, "Reconnecting"));
}

// ---------- activity ----------

function feedPanel() {
  document.getElementById("feed")?.remove();
  const panel = el("aside", {
    class: "feed",
    id: "feed",
    "aria-label": "Recent activity",
  });
  fillFeed(panel);
  return panel;
}

function renderFeed() {
  const p = document.getElementById("feed");
  if (p) fillFeed(p);
}

function fillFeed(panel) {
  panel.replaceChildren(
    el(
      "div",
      { class: "feed-head" },
      "Recent activity",
      el("span", { class: "spacer" }),
      el("button", {
        class: "btn btn-ghost icon-btn",
        icon: "x",
        "aria-label": "Close",
        onclick: () => {
          state.feedOpen = false;
          render();
        },
      }),
    ),
    ...(state.feed.length
      ? state.feed.map((f) =>
          el(
            "div",
            { class: "feed-row" },
            f.avatar
              ? el(
                  "span",
                  { class: "avatar" },
                  el("img", { src: f.avatar, alt: "" }),
                )
              : avatar(f.who),
            el(
              "p",
              {},
              el("b", {}, f.who),
              " ",
              f.message.replace(/^team: /, ""),
              el("time", { datetime: f.when }, ago(f.when)),
            ),
          ),
        )
      : [el("p", { class: "hint", style: null }, "No changes yet.")]),
  );
}

// ---------- task drawer ----------

function openTask(id, opts = {}) {
  state.openId = id;
  state.askProof = !!opts.askProof;
  if (location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
  renderDrawer();
}

function closeDrawer() {
  state.openId = null;
  state.dirty = false;
  document.getElementById("drawer-root")?.remove();
  history.replaceState(null, "", location.pathname);
}

function renderDrawer() {
  document.getElementById("drawer-root")?.remove();
  const task = state.board?.tasks.find((t) => t.id === state.openId);
  if (!task) {
    if (state.board) {
      toast(`${state.openId} isn't on the board`, true);
      closeDrawer();
    }
    return;
  }
  const select = (name, options, value, labels) =>
    el(
      "select",
      { class: "field", id: `f-${name}`, "aria-label": name },
      ...options.map((o) => {
        const opt = el(
          "option",
          { value: o },
          labels ? (labels[o] ?? o) : o || "Unassigned",
        );
        if (o === value) opt.selected = true;
        return opt;
      }),
    );

  // A textarea, so a long title wraps instead of being cut off at the drawer edge.
  const title = el("textarea", {
    class: "title-input",
    rows: "1",
    "aria-label": "Title",
    maxlength: "200",
  }, task.title);
  const fitTitle = () => { title.style.height = "auto"; title.style.height = `${title.scrollHeight}px`; };
  title.addEventListener("input", fitTitle);
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } });
  requestAnimationFrame(fitTitle);
  const status = select("status", state.board.statuses, task.status, LABEL);
  const owner = select(
    "owner",
    ["", ...state.board.members.map((m) => m.name)],
    task.owner,
  );
  const priority = select(
    "priority",
    state.board.priorities,
    task.priority || "none",
    PRIORITY_LABEL,
  );
  const due = el("input", {
    class: "field",
    type: "date",
    id: "f-due",
    value: task.due,
    "aria-label": "Due date",
  });
  const labels = el("input", {
    class: "field",
    id: "f-labels",
    value: task.labels.join(", "),
    placeholder: "onboarding, desktop",
    "aria-label": "Labels",
  });
  const doneWhen = el(
    "textarea",
    {
      class: "field",
      placeholder: "What has to be true for this to count as done",
      "aria-label": "Done when",
      maxlength: "600",
    },
    task.done_when,
  );
  const proof = el("input", {
    class: "field",
    type: "url",
    value: task.proof,
    placeholder: "https:// link, video or commit",
    "aria-label": "Proof",
  });
  const proofHint = el(
    "p",
    { class: "hint" },
    "Required before a task can move to Done.",
  );
  const notes = el(
    "textarea",
    {
      class: "field",
      placeholder: "Context, links, decisions",
      "aria-label": "Notes",
      maxlength: "8000",
    },
    task.notes,
  );
  const saveHint = el(
    "span",
    { class: "hint" },
    task.source ? `From ${task.source}` : "",
  );
  const saveBtn = el(
    "button",
    { class: "btn btn-primary", type: "button" },
    "Save",
  );

  for (const input of [title, doneWhen, proof, notes, labels, due])
    input.addEventListener("input", () => {
      state.dirty = true;
      saveHint.textContent = "Unsaved changes";
    });
  if (state.askProof) {
    proof.classList.add("invalid");
    proofHint.className = "hint err";
    proofHint.textContent = "Add a proof link to mark this done.";
    setTimeout(() => proof.focus(), 50);
  }

  const quick = (changes) =>
    patch(task.id, changes).then((ok) => {
      if (ok) renderDrawer();
    });
  status.addEventListener("change", () => {
    if (status.value === "done" && !proof.value.trim()) {
      status.value = task.status;
      proof.classList.add("invalid");
      proofHint.className = "hint err";
      proofHint.textContent = "Add a proof link first, then mark it done.";
      proof.focus();
      return;
    }
    quick(
      status.value === "done"
        ? { status: "done", proof: proof.value.trim() }
        : { status: status.value },
    );
  });
  owner.addEventListener("change", () => quick({ owner: owner.value }));
  priority.addEventListener("change", () =>
    quick({ priority: priority.value }),
  );

  saveBtn.addEventListener("click", async () => {
    const changes = {};
    if (title.value.trim() !== task.title) changes.title = title.value;
    if (due.value !== task.due) changes.due = due.value;
    if (doneWhen.value.trim() !== task.done_when)
      changes.done_when = doneWhen.value;
    if (proof.value.trim() !== task.proof) changes.proof = proof.value.trim();
    if (notes.value.trim() !== task.notes) changes.notes = notes.value;
    const lbl = labels.value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (lbl.join(",") !== task.labels.join(",")) changes.labels = lbl;
    if (!Object.keys(changes).length) {
      saveHint.textContent = "Nothing changed";
      return;
    }
    if (changes.title !== undefined && !changes.title.trim()) {
      title.focus();
      saveHint.textContent = "A task needs a title";
      return;
    }
    saveBtn.disabled = true;
    saveHint.textContent = "Saving";
    const ok = await patch(task.id, changes);
    saveBtn.disabled = false;
    state.dirty = !ok;
    if (ok) {
      state.askProof = false;
      renderDrawer();
      toast(`${task.id} saved`);
    } else saveHint.textContent = "Not saved";
  });

  const comment = el("input", {
    class: "field",
    placeholder: "Leave a comment",
    "aria-label": "Comment",
    maxlength: "2000",
  });
  const send = el("button", { class: "btn", type: "button" }, "Comment");
  const postComment = async () => {
    const text = comment.value.trim();
    if (!text) return;
    send.disabled = true;
    const ok = await patch(task.id, { comment: text });
    send.disabled = false;
    if (ok) renderDrawer();
  };
  send.addEventListener("click", postComment);
  comment.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      postComment();
    }
  });

  const prop = (label, input) => [
    el("label", { for: input.id || "" }, label),
    input,
  ];
  const activity = el(
    "ul",
    { class: "activity" },
    ...[...task.activity].reverse().map((a) => {
      const m = /^(\S+) ([^:]+): (.*)$/.exec(a);
      return m
        ? el("li", {}, el("b", {}, m[2]), " ", m[3], ` · ${m[1]}`)
        : el("li", {}, a);
    }),
  );

  const drawer = el(
    "aside",
    {
      class: "drawer",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": `${task.id} ${task.title}`,
    },
    el(
      "div",
      { class: "drawer-head" },
      el("span", { svg: statusIcon(task.status) }),
      task.id,
      el("span", { class: "spacer" }),
      el("button", {
        class: "btn btn-ghost icon-btn",
        icon: "x",
        "aria-label": "Close",
        onclick: () => tryClose(),
      }),
    ),
    el(
      "div",
      { class: "drawer-body" },
      title,
      el(
        "div",
        { class: "props" },
        ...prop("Status", status),
        ...prop("Assignee", owner),
        ...prop("Priority", priority),
        ...prop("Due", due),
        ...prop("Labels", labels),
      ),
      el("div", { class: "stack" }, el("label", {}, "Done when"), doneWhen),
      el(
        "div",
        { class: "stack" },
        el("label", {}, "Proof"),
        proof,
        proofHint,
        task.proof && /^https?:\/\//.test(task.proof)
          ? el(
              "a",
              {
                href: task.proof,
                target: "_blank",
                rel: "noopener noreferrer",
              },
              "Open proof",
            )
          : null,
      ),
      el("div", { class: "stack" }, el("label", {}, "Notes"), notes),
      el(
        "div",
        { class: "stack" },
        el("h3", { class: "section-label" }, "Activity"),
        el("div", { class: "comment-row" }, comment, send),
        activity,
      ),
    ),
    el(
      "div",
      { class: "drawer-foot" },
      saveHint,
      el(
        "button",
        { class: "btn btn-ghost", onclick: () => tryClose() },
        "Close",
      ),
      saveBtn,
    ),
  );

  document.body.append(
    el(
      "div",
      { id: "drawer-root" },
      el("div", { class: "scrim", onclick: () => tryClose() }),
      drawer,
    ),
  );
  if (!state.askProof) title.focus({ preventScroll: true });
}

function tryClose() {
  if (state.dirty && !confirm("Discard unsaved changes?")) return;
  closeDrawer();
}

// ---------- create ----------

function openCreate() {
  document.getElementById("dialog-root")?.remove();
  const status = state.view === "inbox" ? "inbox" : "todo";
  const title = el("input", {
    class: "big",
    placeholder: "Task title",
    "aria-label": "Title",
    maxlength: "200",
    required: true,
  });
  const owner = el(
    "select",
    { class: "field", "aria-label": "Assignee" },
    el("option", { value: "" }, "Unassigned"),
    ...state.board.members.map((m) => el("option", { value: m.name }, m.name)),
  );
  if (state.view === "person") owner.value = state.person;
  if (state.view === "mine") owner.value = state.me.member;
  const due = el("input", {
    class: "field",
    type: "date",
    "aria-label": "Due date",
  });
  const priority = el(
    "select",
    { class: "field", "aria-label": "Priority" },
    ...state.board.priorities.map((p) =>
      el("option", { value: p }, PRIORITY_LABEL[p]),
    ),
  );
  priority.value = "none";
  const doneWhen = el("textarea", {
    class: "field",
    placeholder: "Done when (optional)",
    "aria-label": "Done when",
    maxlength: "600",
  });
  const submit = el(
    "button",
    { class: "btn btn-primary", type: "submit" },
    "Create task",
  );
  const hint = el("span", { class: "hint" }, "");
  const close = () => document.getElementById("dialog-root")?.remove();
  const form = el(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!title.value.trim()) {
          title.focus();
          return;
        }
        submit.disabled = true;
        hint.textContent = "Creating";
        try {
          const task = await api("/api/tasks", {
            method: "POST",
            body: JSON.stringify({
              title: title.value,
              owner: owner.value,
              due: due.value,
              priority: priority.value,
              done_when: doneWhen.value,
              status,
            }),
          });
          state.board.tasks.push(task);
          state.board.version = "local";
          close();
          render();
          toast(`${task.id} created`);
          loadFeed();
        } catch (err) {
          submit.disabled = false;
          hint.className = "hint err";
          hint.textContent = err.message;
        }
      },
    },
    el("div", { class: "crumb" }, `Chewbacca · New task in ${LABEL[status]}`),
    title,
    el("div", { class: "row3" }, owner, due, priority),
    doneWhen,
    el(
      "div",
      { class: "dialog-foot" },
      hint,
      el(
        "div",
        {},
        el(
          "button",
          { class: "btn btn-ghost", type: "button", onclick: close },
          "Cancel",
        ),
        " ",
        submit,
      ),
    ),
  );
  document.body.append(
    el(
      "div",
      { id: "dialog-root" },
      el("div", { class: "scrim", onclick: close }),
      el(
        "div",
        {
          class: "dialog",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "New task",
        },
        form,
      ),
    ),
  );
  title.focus();
}

async function signOut() {
  await fetch("/auth/logout", {
    method: "POST",
    headers: { "X-Team-Request": "1" },
  });
  state.me = null;
  render();
}

// ---------- boot ----------

document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(
    document.activeElement?.tagName || "",
  );
  if (e.key === "Escape") {
    if (document.getElementById("dialog-root"))
      document.getElementById("dialog-root").remove();
    else if (state.openId) tryClose();
    else if (state.feedOpen) {
      state.feedOpen = false;
      render();
    }
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !state.board) return;
  if (e.key === "c") {
    e.preventDefault();
    openCreate();
  }
  if (e.key === "/") {
    e.preventDefault();
    document.getElementById("search")?.focus();
  }
});

window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1).toUpperCase();
  if (/^CHW-\d+$/.test(id)) openTask(id);
});

async function boot() {
  try {
    state.me = await api("/api/me");
  } catch {
    state.me = null;
  }
  render();
  if (!state.me) return;
  await loadBoard();
  const id = location.hash.slice(1).toUpperCase();
  if (/^CHW-\d+$/.test(id)) openTask(id);
  setInterval(() => {
    if (document.visibilityState === "visible" && !state.dirty) loadBoard();
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadBoard();
  });
}

boot();
