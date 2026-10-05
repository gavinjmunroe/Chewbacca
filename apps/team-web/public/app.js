// Board client. Every string from a task goes into the page through
// textContent, never innerHTML: titles, comments and notes are typed by
// teammates and commits, and the only markup set by string is the fixed icons.
const BOARD_COLUMNS = ["backlog", "todo", "in_progress", "in_review", "done"];
const STATUS_ORDER = [
  "in_progress",
  "in_review",
  "todo",
  "backlog",
  "inbox",
  "done",
  "ideas",
  "canceled",
];
const LABEL = {
  inbox: "Inbox",
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  ideas: "Idea bin",
  canceled: "Canceled",
};
const PRIORITIES = ["urgent", "high", "medium", "low", "none"];
const PRIORITY_LABEL = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};
const AREA_LABEL = {
  feature: "Features",
  functionality: "Functionality",
  design: "Design",
  business: "Business",
};
const GROUPS = {
  status: "Status",
  area: "Area",
  owner: "Assignee",
  priority: "Priority",
  none: "None",
};
const SORTS = {
  priority: "Priority",
  due: "Due date",
  updated: "Updated",
  id: "Newest",
  title: "Title",
};
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
  table:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6.5h12M6 6.5V13"/></svg>',
  pulse:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8h3l2-4.5 3 9 2-4.5h3"/></svg>',
  help: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 0 1 3.4.6c0 1.2-1.7 1.5-1.7 2.6"/><circle cx="8" cy="11.6" r=".5" fill="currentColor"/></svg>',
  bulb: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12.5h4M6.5 14.5h3M8 1.8a4.2 4.2 0 0 0-2.4 7.6c.5.4.9 1 .9 1.6v.5h3v-.5c0-.6.4-1.2.9-1.6A4.2 4.2 0 0 0 8 1.8z"/></svg>',
  feature:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 10.8 4.5 12.7l.8-3.9L2.4 6.1l3.9-.5z"/></svg>',
  functionality:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M10.5 2.5a3 3 0 0 0-3.9 3.9L2.5 10.5l3 3 4.1-4.1a3 3 0 0 0 3.9-3.9l-1.8 1.8-2-.5-.5-2z"/></svg>',
  design:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5.8"/><circle cx="5.8" cy="6.3" r=".9" fill="currentColor"/><circle cx="8.6" cy="5" r=".9" fill="currentColor"/><circle cx="10.7" cy="7.3" r=".9" fill="currentColor"/></svg>',
  business:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2" y="5" width="12" height="8.5" rx="1.5"/><path d="M5.5 5V3.5h5V5"/></svg>',
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
    ideas: `${s}<circle cx="7" cy="7" r="5.5" stroke="#62666d" stroke-width="1.5" stroke-dasharray="0.8 2.2" stroke-linecap="round"/><circle cx="7" cy="7" r="1.6" fill="#8a8f98"/></svg>`,
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

// ---------- state, kept in the URL so any view can be shared as a link ----------

const URL_KEYS = ["view", "person", "area", "q", "layout", "group", "sort"];
const URL_DEFAULTS = {
  view: "inbox",
  layout: "list",
  group: "status",
  sort: "priority",
};
const state = {
  me: null,
  board: null,
  view: "inbox",
  person: null,
  area: null,
  q: "",
  layout: "list",
  group: "status",
  sort: "priority",
  feedOpen: false,
  feed: [],
  openId: null,
  dirty: false,
  error: null,
  synced: true,
  closed: {},
  selected: new Set(),
  lastPicked: null,
  cursor: -1,
};
function readUrl() {
  const p = new URLSearchParams(location.search);
  for (const k of URL_KEYS) if (p.get(k)) state[k] = p.get(k);
  if (!GROUPS[state.group]) state.group = "status";
  if (!SORTS[state.sort]) state.sort = "priority";
  if (!["list", "board", "table"].includes(state.layout)) state.layout = "list";
}
function writeUrl() {
  const p = new URLSearchParams();
  for (const k of URL_KEYS)
    if (state[k] && state[k] !== URL_DEFAULTS[k]) p.set(k, state[k]);
  const qs = p.toString();
  history.replaceState(
    null,
    "",
    `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`,
  );
}
try {
  state.closed = JSON.parse(localStorage.getItem("team.closed") || "{}");
} catch {
  /* private mode: defaults are fine */
}
readUrl();
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
// Only fixed icon markup from this file reaches svg(); never task text.
const svg = (markup) => el("span", { class: "ico", svg: markup });

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

const member = (name) => state.board?.members.find((m) => m.name === name);
const isClosed = (t) => ["done", "canceled", "ideas"].includes(t.status);
const kids = (id) => state.board.tasks.filter((t) => t.parent === id);

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
  const late = !isClosed(task) && task.due < state.board.today;
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

const labelPill = (l) => el("span", { class: "label" }, el("i"), l);

function progressPill(t) {
  const children = kids(t.id);
  if (!children.length) return null;
  const done = children.filter((c) => c.status === "done").length;
  return el(
    "span",
    { class: "label", title: "Sub-tasks done" },
    `${done}/${children.length}`,
  );
}

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied: ${text}`);
  } catch {
    toast("Couldn't copy; select the text instead", true);
  }
}

// ---------- filtering: the view, then a GitHub-style query ----------

// owner:me resolves to the signed-in person; no:owner and no:due find what
// still needs deciding; a leading "-" negates any token.
function parseQuery(q) {
  const tokens = q.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const filters = [];
  const words = [];
  for (const tok of tokens) {
    const m =
      /^(-?)(owner|assignee|label|area|status|priority|is|no|has|parent):(.+)$/i.exec(
        tok,
      );
    if (!m) {
      words.push(tok.replace(/"/g, "").toLowerCase());
      continue;
    }
    filters.push({
      neg: m[1] === "-",
      key: m[2].toLowerCase(),
      value: m[3].replace(/"/g, "").toLowerCase(),
    });
  }
  return { filters, words };
}

function field(t, name) {
  return name === "assignee" ? t.owner : t[name];
}

function matchFilter(t, { key, value }) {
  const me = state.me.member.toLowerCase();
  switch (key) {
    case "owner":
    case "assignee":
      return (value === "me" ? me : value) === t.owner.toLowerCase();
    case "label":
      return t.labels.some((l) => l.toLowerCase() === value);
    case "area":
      return (
        t.area === value || (AREA_LABEL[t.area] || "").toLowerCase() === value
      );
    case "status":
      return (
        t.status === value.replace(/[- ]/g, "_") ||
        (LABEL[t.status] || "").toLowerCase() === value
      );
    case "priority":
      return (t.priority || "none") === value;
    case "parent":
      return t.parent.toLowerCase() === value;
    case "is":
      return value === "open"
        ? !isClosed(t)
        : value === "closed"
          ? isClosed(t)
          : value === "overdue"
            ? !!t.due && t.due < state.board.today && !isClosed(t)
            : false;
    case "no": {
      const v = field(t, value);
      return Array.isArray(v) ? !v.length : !v;
    }
    case "has": {
      const v = field(t, value);
      return Array.isArray(v) ? !!v.length : !!v;
    }
    default:
      return true;
  }
}

function inView(t) {
  if (state.view === "inbox" && t.status !== "inbox") return false;
  // The idea bin keeps spectacle and speculative items saved but out of every other view.
  if ((state.view === "ideas") !== (t.status === "ideas")) return false;
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
  if (state.view === "area" && t.area !== state.area) return false;
  if (
    state.view !== "inbox" &&
    t.status === "inbox" &&
    !["all", "area"].includes(state.view)
  )
    return false;
  const { filters, words } = parseQuery(state.q);
  for (const f of filters) if (matchFilter(t, f) === f.neg) return false;
  if (words.length) {
    const hay =
      `${t.id} ${t.title} ${t.owner} ${t.labels.join(" ")} ${t.source} ${t.notes}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

function sortTasks(list) {
  const pr = (t) => PRIORITIES.indexOf(t.priority || "none");
  const id = (t) => Number(t.id.split("-")[1]);
  const by = {
    priority: (a, b) => pr(a) - pr(b) || id(b) - id(a),
    due: (a, b) =>
      (a.due || "9999").localeCompare(b.due || "9999") || pr(a) - pr(b),
    updated: (a, b) =>
      (b.updated || "").localeCompare(a.updated || "") || id(b) - id(a),
    id: (a, b) => id(b) - id(a),
    title: (a, b) => a.title.localeCompare(b.title),
  }[state.sort];
  return [...list].sort(by);
}

function groupTasks(list) {
  const g =
    state.view === "inbox" && state.group === "status" ? "area" : state.group;
  if (g === "none") return [["all", "All", list, null]];
  if (g === "status")
    return STATUS_ORDER.map((s) => [
      s,
      LABEL[s],
      list.filter((t) => t.status === s),
      statusIcon(s),
    ]);
  if (g === "area")
    return [
      ...Object.entries(AREA_LABEL).map(([k, v]) => [
        `area:${k}`,
        v,
        list.filter((t) => t.area === k),
        ICON[k],
      ]),
      ["area:none", "No area", list.filter((t) => !AREA_LABEL[t.area]), null],
    ];
  if (g === "priority")
    return PRIORITIES.map((p) => [
      `p:${p}`,
      PRIORITY_LABEL[p],
      list.filter((t) => (t.priority || "none") === p),
      priorityIcon(p),
    ]);
  return [
    ...state.board.members.map((m) => [
      `o:${m.name}`,
      m.name,
      list.filter((t) => t.owner === m.name),
      null,
    ]),
    ["o:", "Unassigned", list.filter((t) => !t.owner), null],
  ];
}

const visible = () => sortTasks(state.board.tasks.filter(inView));

const viewTitle = () =>
  ({
    inbox: "Inbox",
    mine: "My tasks",
    active: "Active",
    all: "All tasks",
    ideas: "Idea bin",
    person: state.person,
    area: AREA_LABEL[state.area],
  })[state.view] || "Tasks";

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

async function bulk(changes) {
  const ids = [...state.selected];
  const tasks = ids
    .map((id) => state.board.tasks.find((t) => t.id === id))
    .filter(Boolean);
  const before = tasks.map((t) => ({ ...t }));
  tasks.forEach((t) => Object.assign(t, changes));
  render();
  try {
    const { updated } = await api("/api/bulk", {
      method: "POST",
      body: JSON.stringify({ ids, changes }),
    });
    for (const u of updated)
      Object.assign(state.board.tasks.find((t) => t.id === u.id) || {}, u);
    state.board.version = "local";
    state.selected.clear();
    render();
    toast(`${updated.length} tasks updated in one commit`);
    loadFeed();
  } catch (err) {
    tasks.forEach((t, i) => Object.assign(t, before[i]));
    render();
    toast(err.message, true);
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
  writeUrl();
  app.replaceChildren(
    el(
      "div",
      { class: "shell" },
      sidebar(),
      el("main", { class: "main" }, mobileNav(), topBar(), toolbar(), body()),
    ),
  );
  document.getElementById("bulkbar")?.remove();
  if (state.selected.size) document.body.append(bulkBar());
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
        el(
          "p",
          { class: "fine" },
          "For anyone with write access to calebnewtonusc/Chewbacca. No access yet? Send Caleb your GitHub username.",
        ),
      ),
    ),
  );
}

function go(view, extra = {}) {
  Object.assign(state, { view, person: null, area: null, cursor: -1 }, extra);
  state.selected.clear();
  render();
}

function sidebar() {
  const tasks = state.board.tasks;
  const count = (fn) => tasks.filter(fn).length;
  const open = (t) => !isClosed(t) && t.status !== "inbox";
  const nav = (key, icon, label, n, extra) => {
    const on =
      state.view === key &&
      (!extra ||
        (extra.person
          ? state.person === extra.person
          : state.area === extra.area));
    return el(
      "button",
      { class: `nav${on ? " on" : ""}`, onclick: () => go(key, extra) },
      icon instanceof Node ? icon : svg(ICON[icon]),
      el("span", {}, label),
      n ? el("span", { class: "n" }, String(n)) : null,
    );
  };
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
    nav(
      "all",
      "list",
      "All tasks",
      count((t) => t.status !== "ideas"),
    ),
    nav(
      "ideas",
      "bulb",
      "Idea bin",
      count((t) => t.status === "ideas"),
    ),
    el("div", { class: "nav-label" }, "Areas"),
    ...Object.entries(AREA_LABEL).map(([k, v]) =>
      nav(
        "area",
        k,
        v,
        count((t) => t.area === k && !isClosed(t)),
        { area: k },
      ),
    ),
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
    chip("ideas", "Ideas"),
  );
}

function topBar() {
  const layoutBtn = (key, label) =>
    el("button", {
      class: `btn btn-ghost icon-btn${state.layout === key ? " on" : ""}`,
      icon: key,
      title: label,
      "aria-label": label,
      "aria-pressed": String(state.layout === key),
      onclick: () => {
        state.layout = key;
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
      el("span", { class: "count" }, String(visible().length)),
    ),
    el("span", { class: "spacer" }),
    state.synced
      ? null
      : el("span", { class: "sync-off", id: "sync" }, "Reconnecting"),
    layoutBtn("list", "List"),
    layoutBtn("table", "Table"),
    layoutBtn("board", "Board"),
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
    el("button", {
      class: "btn btn-ghost icon-btn",
      icon: "help",
      title: "How this works (?)",
      "aria-label": "How this works",
      onclick: openHelp,
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

function toolbar() {
  const filter = el("input", {
    class: "filter",
    id: "filter",
    type: "search",
    value: state.q,
    spellcheck: "false",
    placeholder:
      "Filter: owner:me area:design label:os is:open no:owner, or words",
    "aria-label": "Filter tasks",
  });
  let t;
  filter.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.q = filter.value;
      refreshBody();
      writeUrl();
    }, 120);
  });
  const pick = (label, key, options) => {
    const s = el(
      "select",
      { class: "mini", "aria-label": label },
      ...Object.entries(options).map(([k, v]) => {
        const o = el("option", { value: k }, `${label}: ${v}`);
        if (state[key] === k) o.selected = true;
        return o;
      }),
    );
    s.addEventListener("change", () => {
      state[key] = s.value;
      render();
    });
    return s;
  };
  return el(
    "div",
    { class: "toolbar" },
    filter,
    state.layout === "board" ? null : pick("Group", "group", GROUPS),
    pick("Sort", "sort", SORTS),
  );
}

function refreshBody() {
  document.getElementById("body")?.replaceWith(body());
  const c = document.querySelector(".bar .count");
  if (c) c.textContent = String(visible().length);
}

function body() {
  const tasks = visible();
  const node =
    state.layout === "board"
      ? boardView(tasks)
      : state.layout === "table"
        ? tableView(tasks)
        : listView(tasks);
  node.id = "body";
  return node;
}

function emptyState() {
  const filtered = !!state.q.trim();
  return el(
    "div",
    { class: "empty-state" },
    el(
      "h2",
      {},
      filtered
        ? "No tasks match that filter"
        : state.view === "inbox"
          ? "Inbox zero"
          : "Nothing here",
    ),
    el(
      "p",
      {},
      filtered
        ? "Clear the filter or loosen it."
        : state.view === "inbox"
          ? "Everything has been triaged."
          : "No tasks in this view yet.",
    ),
    filtered
      ? el(
          "button",
          {
            class: "btn",
            onclick: () => {
              state.q = "";
              render();
            },
          },
          "Clear filter",
        )
      : el(
          "button",
          { class: "btn", icon: "plus", onclick: () => openCreate() },
          "New task",
        ),
  );
}

// ---------- help ----------

function openHelp() {
  document.getElementById("dialog-root")?.remove();
  const close = () => document.getElementById("dialog-root")?.remove();
  const kv = (k, v) =>
    el("div", { class: "help-row" }, el("code", {}, k), el("span", {}, v));
  const panel = el(
    "div",
    {
      class: "dialog help",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "How this works",
    },
    el(
      "div",
      { class: "help-body" },
      el("h2", {}, "How the board works"),
      el(
        "p",
        {},
        "Every task is a file in the Chewbacca repo. Edits here are commits under your GitHub name; the team CLI reads and writes the same files.",
      ),
      el("h3", {}, "Your commits move tasks"),
      kv("feat: onboarding CHW-12", "logs the commit on CHW-12 and starts it"),
      kv(
        "Fixes CHW-12",
        "on its own line: closes CHW-12 with the commit as proof",
      ),
      el("h3", {}, "Filter"),
      kv("owner:me", "your tasks; also owner:gavin"),
      kv("area:design  label:os", "by area or label"),
      kv("is:open  is:overdue", "open or late work"),
      kv(
        "no:owner  no:due",
        "what still needs deciding; prefix any token with - to exclude",
      ),
      el("h3", {}, "Keyboard"),
      kv("c", "new task"),
      kv("/", "filter"),
      kv("j  k", "move down and up"),
      kv("x", "select; shift-click selects a range"),
      kv("Enter", "open"),
      kv("Esc", "close or clear selection"),
      el("h3", {}, "Terminal"),
      kv("team", "the board"),
      kv("team mine", "your open tasks"),
      kv("team done CHW-12 --proof <link>", "finish with proof"),
    ),
    el(
      "div",
      { class: "dialog-foot" },
      el("span", {}),
      el("button", { class: "btn", onclick: close }, "Got it"),
    ),
  );
  document.body.append(
    el(
      "div",
      { id: "dialog-root" },
      el("div", { class: "scrim", onclick: close }),
      panel,
    ),
  );
}

// ---------- selection ----------

function pick(id, e) {
  const order = visible().map((t) => t.id);
  if (e?.shiftKey && state.lastPicked && order.includes(state.lastPicked)) {
    const [a, b] = [order.indexOf(state.lastPicked), order.indexOf(id)].sort(
      (x, y) => x - y,
    );
    order.slice(a, b + 1).forEach((x) => state.selected.add(x));
  } else if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  state.lastPicked = id;
  render();
}

function checkbox(t) {
  const box = el("input", {
    type: "checkbox",
    class: "pick",
    "aria-label": `Select ${t.id}`,
  });
  box.checked = state.selected.has(t.id);
  box.addEventListener("click", (e) => {
    e.stopPropagation();
    pick(t.id, e);
  });
  return box;
}

function bulkBar() {
  const n = state.selected.size;
  const sel = (label, key, options) => {
    const s = el(
      "select",
      { class: "mini", "aria-label": `Set ${label}` },
      el("option", { value: "__" }, label),
      ...Object.entries(options).map(([k, v]) => el("option", { value: k }, v)),
    );
    s.addEventListener("change", () => {
      if (s.value !== "__") bulk({ [key]: s.value });
    });
    return s;
  };
  const statuses = Object.fromEntries(
    Object.entries(LABEL).filter(([k]) => k !== "done"),
  );
  return el(
    "div",
    {
      class: "bulkbar",
      id: "bulkbar",
      role: "toolbar",
      "aria-label": "Bulk edit",
    },
    el("span", { class: "n" }, `${n} selected`),
    sel("Status", "status", statuses),
    sel("Assignee", "owner", {
      "": "Unassigned",
      ...Object.fromEntries(state.board.members.map((m) => [m.name, m.name])),
    }),
    sel("Priority", "priority", PRIORITY_LABEL),
    sel("Area", "area", { "": "No area", ...AREA_LABEL }),
    el(
      "button",
      {
        class: "btn btn-ghost",
        onclick: () => {
          visible().forEach((t) => state.selected.add(t.id));
          render();
        },
      },
      "Select all",
    ),
    el(
      "button",
      {
        class: "btn btn-ghost",
        onclick: () => {
          state.selected.clear();
          render();
        },
      },
      "Clear",
    ),
  );
}

// ---------- list ----------

function listView(tasks) {
  const wrap = el("section", { "aria-label": "Tasks" });
  if (!tasks.length) {
    wrap.append(emptyState());
    return wrap;
  }
  for (const [key, name, items, icon] of groupTasks(tasks)) {
    if (!items.length) continue;
    const closed = !!state.closed[key];
    if (key !== "all") {
      wrap.append(
        el(
          "button",
          {
            class: `group-head${closed ? " closed" : ""}`,
            "aria-expanded": String(!closed),
            onclick: () => {
              state.closed[key] = !closed;
              try {
                localStorage.setItem(
                  "team.closed",
                  JSON.stringify(state.closed),
                );
              } catch {
                /* private mode */
              }
              render();
            },
          },
          svg(ICON.chev),
          icon ? svg(icon) : null,
          name,
          el("span", { class: "n" }, String(items.length)),
        ),
      );
    }
    if (!closed) wrap.append(...items.map(row));
  }
  return wrap;
}

function row(t) {
  const r = el(
    "div",
    {
      class: `row${isClosed(t) ? " closed" : ""}${state.selected.has(t.id) ? " sel" : ""}`,
      role: "button",
      tabindex: "0",
      "data-id": t.id,
      "aria-label": `${t.id} ${t.title}`,
    },
    checkbox(t),
    svg(priorityIcon(t.priority)),
    el("span", { class: "id" }, t.id),
    svg(statusIcon(t.status)),
    el(
      "span",
      { class: "title" },
      t.parent ? el("span", { class: "parent-ref" }, `${t.parent} › `) : null,
      t.title,
    ),
    el(
      "span",
      { class: "meta" },
      progressPill(t),
      ...t.labels
        .filter((l) => l !== "backlog")
        .slice(0, 2)
        .map(labelPill),
    ),
    dueText(t) || el("span"),
    avatar(t.owner),
  );
  r.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) pick(t.id, e);
    else openTask(t.id);
  });
  r.addEventListener("keydown", (e) => {
    if (e.key === "Enter") openTask(t.id);
  });
  return r;
}

// ---------- table ----------

function tableView(tasks) {
  const wrap = el("section", { class: "table-wrap", "aria-label": "Tasks" });
  if (!tasks.length) {
    wrap.append(emptyState());
    return wrap;
  }
  const cols = [
    ["id", "ID"],
    ["title", "Title"],
    ["status", "Status"],
    ["area", "Area"],
    ["owner", "Assignee"],
    ["priority", "Priority"],
    ["due", "Due"],
    ["updated", "Updated"],
  ];
  const sortable = {
    id: "id",
    title: "title",
    priority: "priority",
    due: "due",
    updated: "updated",
  };
  const head = el(
    "tr",
    {},
    el("th", { class: "c-pick" }),
    ...cols.map(([k, v]) =>
      el(
        "th",
        {},
        sortable[k]
          ? el(
              "button",
              {
                class: `th-sort${state.sort === sortable[k] ? " on" : ""}`,
                onclick: () => {
                  state.sort = sortable[k];
                  render();
                },
              },
              v,
            )
          : v,
      ),
    ),
  );
  const rows = groupTasks(tasks).flatMap(([key, name, items]) =>
    !items.length
      ? []
      : [
          ...(key === "all"
            ? []
            : [
                el(
                  "tr",
                  { class: "t-group" },
                  el(
                    "td",
                    { colspan: String(cols.length + 1) },
                    name,
                    " ",
                    el("span", { class: "n" }, String(items.length)),
                  ),
                ),
              ]),
          ...items.map((t) => {
            const tr = el(
              "tr",
              {
                class: state.selected.has(t.id) ? "sel" : "",
                "data-id": t.id,
                tabindex: "0",
              },
              el("td", { class: "c-pick" }, checkbox(t)),
              el("td", { class: "c-id" }, t.id),
              el("td", { class: "c-title" }, t.title),
              el(
                "td",
                {},
                el(
                  "span",
                  { class: "cell" },
                  svg(statusIcon(t.status)),
                  LABEL[t.status],
                ),
              ),
              el("td", {}, AREA_LABEL[t.area] || ""),
              el(
                "td",
                {},
                el("span", { class: "cell" }, avatar(t.owner), t.owner || ""),
              ),
              el(
                "td",
                {},
                el(
                  "span",
                  { class: "cell" },
                  svg(priorityIcon(t.priority)),
                  PRIORITY_LABEL[t.priority || "none"],
                ),
              ),
              el("td", {}, dueText(t) || ""),
              el("td", { class: "c-dim" }, t.updated || ""),
            );
            tr.addEventListener("click", (e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey) pick(t.id, e);
              else openTask(t.id);
            });
            tr.addEventListener("keydown", (e) => {
              if (e.key === "Enter") openTask(t.id);
            });
            return tr;
          }),
        ],
  );
  wrap.append(
    el(
      "table",
      { class: "table" },
      el("thead", {}, head),
      el("tbody", {}, ...rows),
    ),
  );
  return wrap;
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
        svg(statusIcon(status)),
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
      svg(priorityIcon(t.priority)),
      t.id,
      avatar(t.owner),
    ),
    el("div", { class: "title" }, t.title),
    el(
      "div",
      { class: "meta" },
      dueText(t),
      progressPill(t),
      ...t.labels
        .filter((l) => l !== "backlog")
        .slice(0, 2)
        .map(labelPill),
    ),
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
      : [el("p", { class: "hint" }, "No changes yet.")]),
  );
}

// An activity line, with a "commit abc1234" token turned into a link to that commit.
function activityItem(a) {
  const m = /^(\S+) ([^:]+): (.*)$/.exec(a);
  if (!m) return el("li", {}, a);
  const [, date, who, what] = m;
  const c = /^commit ([0-9a-f]{7})\b(.*)$/.exec(what);
  const body =
    c && state.board.repo
      ? [
          el(
            "a",
            {
              href: `https://github.com/${state.board.repo}/commit/${c[1]}`,
              target: "_blank",
              rel: "noopener noreferrer",
            },
            `commit ${c[1]}`,
          ),
          c[2],
        ]
      : [what];
  return el("li", {}, el("b", {}, who), " ", ...body, ` · ${date}`);
}

// ---------- task drawer ----------

function openTask(id, opts = {}) {
  state.openId = id;
  state.askProof = !!opts.askProof;
  if (location.hash !== `#${id}`)
    history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}#${id}`,
    );
  renderDrawer();
}

function closeDrawer() {
  state.openId = null;
  state.dirty = false;
  document.getElementById("drawer-root")?.remove();
  history.replaceState(null, "", `${location.pathname}${location.search}`);
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
  const title = el(
    "textarea",
    {
      class: "title-input",
      rows: "1",
      "aria-label": "Title",
      maxlength: "200",
    },
    task.title,
  );
  const fitTitle = () => {
    title.style.height = "auto";
    title.style.height = `${title.scrollHeight}px`;
  };
  title.addEventListener("input", fitTitle);
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      title.blur();
    }
  });
  requestAnimationFrame(fitTitle);

  const status = select("status", state.board.statuses, task.status, LABEL);
  const owner = select(
    "owner",
    ["", ...state.board.members.map((m) => m.name)],
    task.owner,
  );
  const area = select(
    "area",
    ["", ...Object.keys(AREA_LABEL)],
    task.area || "",
    { "": "No area", ...AREA_LABEL },
  );
  const priority = select(
    "priority",
    state.board.priorities,
    task.priority || "none",
    PRIORITY_LABEL,
  );
  const parentOpts = [
    "",
    ...state.board.tasks
      .filter(
        (t) => t.id !== task.id && t.parent !== task.id && t.status !== "ideas",
      )
      .map((t) => t.id),
  ];
  const parent = select(
    "parent",
    parentOpts,
    task.parent || "",
    Object.fromEntries([
      ["", "None"],
      ...state.board.tasks.map((t) => [
        t.id,
        `${t.id} ${t.title.slice(0, 48)}`,
      ]),
    ]),
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
  area.addEventListener("change", () => quick({ area: area.value }));
  priority.addEventListener("change", () =>
    quick({ priority: priority.value }),
  );
  parent.addEventListener("change", () => quick({ parent: parent.value }));

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

  // sub-tasks
  const children = kids(task.id);
  const subInput = el("input", {
    class: "field",
    placeholder: "Add a sub-task and press Enter",
    "aria-label": "New sub-task",
    maxlength: "200",
  });
  subInput.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !subInput.value.trim()) return;
    e.preventDefault();
    subInput.disabled = true;
    try {
      const created = await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: subInput.value,
          parent: task.id,
          area: task.area || "",
          status: task.status === "inbox" ? "inbox" : "todo",
        }),
      });
      state.board.tasks.push(created);
      state.board.version = "local";
      render();
      toast(`${created.id} added under ${task.id}`);
    } catch (err) {
      subInput.disabled = false;
      toast(err.message, true);
    }
  });
  const subList = el(
    "div",
    { class: "subs" },
    ...children.map((c) =>
      el(
        "button",
        { class: "sub", onclick: () => openTask(c.id) },
        svg(statusIcon(c.status)),
        el("span", { class: "id" }, c.id),
        el("span", { class: "title" }, c.title),
        avatar(c.owner),
      ),
    ),
  );

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

  const commitTip = el(
    "div",
    { class: "commit-tip" },
    el("span", {}, "In a commit message:"),
    el(
      "button",
      {
        class: "btn btn-ghost",
        title: "Copy",
        onclick: () => copy(`Fixes ${task.id}`),
      },
      el("code", {}, `Fixes ${task.id}`),
    ),
    el("span", { class: "hint" }, "closes it with the commit as proof"),
  );

  const prop = (label, input) => [
    el("label", { for: input.id || "" }, label),
    input,
  ];
  const done = children.filter((c) => c.status === "done").length;
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
      svg(statusIcon(task.status)),
      task.parent
        ? el(
            "button",
            { class: "crumb-link", onclick: () => openTask(task.parent) },
            `${task.parent} ›`,
          )
        : null,
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
        ...prop("Area", area),
        ...prop("Priority", priority),
        ...prop("Due", due),
        ...prop("Parent", parent),
        ...prop("Labels", labels),
      ),
      commitTip,
      el(
        "div",
        { class: "stack" },
        el(
          "label",
          {},
          children.length
            ? `Sub-tasks ${done}/${children.length}`
            : "Sub-tasks",
        ),
        subList,
        subInput,
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
        el(
          "ul",
          { class: "activity" },
          ...[...task.activity].reverse().map(activityItem),
        ),
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
  const status =
    state.view === "inbox"
      ? "inbox"
      : state.view === "ideas"
        ? "ideas"
        : "todo";
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
    ...PRIORITIES.map((p) => el("option", { value: p }, PRIORITY_LABEL[p])),
  );
  priority.value = "none";
  const area = el(
    "select",
    { class: "field", "aria-label": "Area" },
    el("option", { value: "" }, "No area"),
    ...Object.entries(AREA_LABEL).map(([k, v]) =>
      el("option", { value: k }, v),
    ),
  );
  if (state.view === "area") area.value = state.area;
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
              area: area.value,
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
    el("div", { class: "row4" }, owner, area, priority, due),
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

// ---------- keyboard ----------

function moveCursor(delta) {
  const rows = [...document.querySelectorAll("#body [data-id]")];
  if (!rows.length) return;
  state.cursor = Math.max(0, Math.min(rows.length - 1, state.cursor + delta));
  rows[state.cursor].focus();
  rows[state.cursor].scrollIntoView({ block: "nearest" });
}

document.addEventListener("keydown", (e) => {
  const active = document.activeElement;
  const typing =
    /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName || "") &&
    active.type !== "checkbox";
  if (e.key === "Escape") {
    if (document.getElementById("dialog-root"))
      document.getElementById("dialog-root").remove();
    else if (state.openId) tryClose();
    else if (state.feedOpen) {
      state.feedOpen = false;
      render();
    } else if (state.selected.size) {
      state.selected.clear();
      render();
    }
    return;
  }
  if (
    typing ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    !state.board ||
    state.openId ||
    document.getElementById("dialog-root")
  )
    return;
  const focused = active?.closest?.("[data-id]")?.dataset.id;
  if (e.key === "c") {
    e.preventDefault();
    openCreate();
  } else if (e.key === "?") {
    e.preventDefault();
    openHelp();
  } else if (e.key === "/") {
    e.preventDefault();
    document.getElementById("filter")?.focus();
  } else if (e.key === "j") {
    e.preventDefault();
    moveCursor(1);
  } else if (e.key === "k") {
    e.preventDefault();
    moveCursor(-1);
  } else if (e.key === "x" && focused) {
    e.preventDefault();
    pick(focused, e);
    requestAnimationFrame(() =>
      document.querySelector(`#body [data-id="${focused}"]`)?.focus(),
    );
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
    if (
      document.visibilityState === "visible" &&
      !state.dirty &&
      !state.selected.size
    )
      loadBoard();
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadBoard();
  });
}

boot();
