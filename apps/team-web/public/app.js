// Board client. Every string from a task goes into the page through
// textContent, never innerHTML: titles, comments and notes are typed by
// teammates and commits, and the only markup set by string is the fixed icons.
const COLUMNS = ["backlog", "todo", "in_progress", "in_review", "done"];
const LABEL = {
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
// 10s keeps a CLI edit visible on the board before anyone notices a lag, and
// costs one GitHub listing call per open tab per poll: 360 an hour, well inside
// the 5,000 an hour each signed-in token gets.
const POLL_MS = 10000;
const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  activity:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  github:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z"/></svg>',
};

const state = {
  me: null,
  board: null,
  filter: "all",
  query: "",
  tab: "todo",
  feedOpen: false,
  feed: [],
  openId: null,
  dirty: false,
  error: null,
  synced: true,
};
const app = document.getElementById("app");

// ---------- helpers ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "icon") { if (Object.hasOwn(ICON, v)) node.insertAdjacentHTML("afterbegin", ICON[v]); }
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "value") node.value = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat())
    if (c !== null && c !== undefined && c !== false)
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
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
  }, 3200);
}

function hue(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function avatar(name, size = "") {
  if (!name)
    return el("span", { class: `avatar none ${size}`, title: "Unassigned" });
  const a = el(
    "span",
    { class: `avatar ${size}`, title: name },
    name.slice(0, 1).toUpperCase(),
  );
  a.style.background = `hsl(${hue(name)} 70% 70%)`;
  return a;
}

function dueTag(task) {
  if (!task.due) return null;
  const today = state.board.today;
  const closed = task.status === "done" || task.status === "canceled";
  const soon = new Date(`${today}T00:00`);
  soon.setDate(soon.getDate() + 2);
  const cls = closed
    ? ""
    : task.due < today
      ? " overdue"
      : new Date(`${task.due}T00:00`) <= soon
        ? " soon"
        : "";
  const label = new Date(`${task.due}T00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return el(
    "span",
    {
      class: `tag${cls}`,
      icon: "cal",
      title: cls === " overdue" ? "Overdue" : "Due",
    },
    label,
  );
}

function prio(p) {
  if (!p || p === "none") return null;
  return el(
    "span",
    {
      class: `prio p-${p}`,
      title: PRIORITY_LABEL[p],
      "aria-label": PRIORITY_LABEL[p],
    },
    el("i"),
    el("i"),
    el("i"),
  );
}

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function visibleTasks() {
  const q = state.query.trim().toLowerCase();
  return state.board.tasks.filter((t) => {
    if (state.filter === "unassigned" && t.owner) return false;
    if (
      state.filter !== "all" &&
      state.filter !== "unassigned" &&
      t.owner !== state.filter
    )
      return false;
    if (
      q &&
      !`${t.id} ${t.title} ${t.owner} ${t.labels.join(" ")}`
        .toLowerCase()
        .includes(q)
    )
      return false;
    return true;
  });
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
    const saved = await api(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    });
    Object.assign(task, saved);
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

// ---------- views ----------

function render() {
  if (!state.me) return renderSignIn();
  if (!state.board) {
    app.replaceChildren(
      header(),
      state.error ? errorBanner() : skeletonBoard(),
    );
    return;
  }
  const layout = el(
    "div",
    { class: "layout" },
    el("div", { class: "main" }, filters(), tabs(), boardView()),
    feedPanel(),
  );
  app.replaceChildren(header(), layout);
  if (state.openId) renderDrawer();
}

function renderSignIn() {
  app.replaceChildren(
    el(
      "main",
      { class: "signin" },
      el(
        "div",
        { class: "signin-card" },
        el("div", { class: "mark" }, "C"),
        el("h1", {}, "Chewbacca team board"),
        el(
          "p",
          {},
          "Who's on what, and what's due. Every task lives in the Chewbacca repo, so the terminal and this page show the same board.",
        ),
        el(
          "a",
          {
            class: "btn btn-primary btn-wide",
            href: "/auth/login",
            icon: "github",
          },
          "Sign in with GitHub",
        ),
      ),
    ),
  );
}

function header() {
  const search = el("input", {
    class: "search",
    type: "search",
    placeholder: "Search tasks",
    "aria-label": "Search tasks",
    value: state.query,
    oninput: (e) => {
      state.query = e.target.value;
      renderBoardOnly();
    },
  });
  search.id = "search";
  return el(
    "header",
    { class: "top" },
    el(
      "div",
      { class: "brand" },
      el("span", { class: "mark" }, "C"),
      "Team",
      el("small", {}, "Chewbacca"),
    ),
    el("div", { class: "spacer" }),
    el(
      "span",
      { class: `sync${state.synced ? "" : " stale"}`, id: "sync" },
      state.synced ? "Live" : "Reconnecting",
    ),
    search,
    el("button", {
      class: "btn btn-ghost icon-btn",
      icon: "activity",
      title: "Recent activity",
      "aria-label": "Recent activity",
      "aria-pressed": String(state.feedOpen),
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
        onclick: openCreate,
        title: "New task (C)",
      },
      el("span", { class: "new-label" }, "New task ", el("kbd", {}, "C")),
    ),
    el(
      "div",
      { class: "me" },
      state.me.avatar
        ? el(
            "span",
            { class: "avatar sm" },
            el("img", { src: state.me.avatar, alt: state.me.member }),
          )
        : avatar(state.me.member, "sm"),
      el("button", { class: "btn btn-ghost", onclick: signOut }, "Sign out"),
    ),
  );
}

function filters() {
  const open = state.board.tasks.filter(
    (t) => t.status !== "done" && t.status !== "canceled",
  );
  const chip = (key, label, count) =>
    el(
      "button",
      {
        class: `chip${state.filter === key ? " on" : ""}`,
        "aria-pressed": String(state.filter === key),
        onclick: () => {
          state.filter = key;
          render();
        },
      },
      label,
      el("span", { class: "count" }, String(count)),
    );
  return el(
    "nav",
    { class: "filters", "aria-label": "Filter by person" },
    chip("all", "Everyone", open.length),
    ...state.board.members.map((m) =>
      chip(m.name, m.name, open.filter((t) => t.owner === m.name).length),
    ),
    chip("unassigned", "Unassigned", open.filter((t) => !t.owner).length),
  );
}

function tabs() {
  return el(
    "nav",
    { class: "tabs", "aria-label": "Status" },
    ...COLUMNS.map((s) =>
      el(
        "button",
        {
          class: `chip${state.tab === s ? " on" : ""}`,
          onclick: () => {
            state.tab = s;
            render();
          },
        },
        el("span", { class: `status-dot s-${s}` }),
        LABEL[s],
      ),
    ),
  );
}

function boardView() {
  const tasks = visibleTasks();
  const board = el("section", {
    class: "board",
    id: "board",
    "aria-label": "Task board",
  });
  for (const status of COLUMNS) {
    const items = tasks.filter((t) => t.status === status);
    const col = el(
      "div",
      {
        class: `col${state.tab === status ? " active" : ""}`,
        "data-status": status,
      },
      el(
        "div",
        { class: `col-head s-${status}` },
        el("span", { class: `status-dot s-${status}` }),
        el("span", { class: "col-name" }, LABEL[status]),
        el("span", { class: "count" }, String(items.length)),
      ),
      el(
        "div",
        { class: "cards" },
        items.length ? items.map(card) : emptyColumn(status),
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
      const id = e.dataTransfer.getData("text/plain");
      const task = state.board.tasks.find((t) => t.id === id);
      if (!task || task.status === status) return;
      if (status === "done" && !task.proof) {
        openTask(id, { askProof: true });
        return;
      }
      patch(id, { status });
    });
    board.append(col);
  }
  return board;
}

function renderBoardOnly() {
  const old = document.getElementById("board");
  if (old) old.replaceWith(boardView());
}

function emptyColumn(status) {
  const box = el(
    "div",
    { class: "empty" },
    status === "done" ? "Nothing finished yet" : "Nothing here",
  );
  if (status === "todo" || status === "backlog")
    box.append(
      el(
        "div",
        {},
        el(
          "button",
          { class: "btn", icon: "plus", onclick: () => openCreate(status) },
          "Add a task",
        ),
      ),
    );
  return box;
}

function card(task) {
  const c = el(
    "button",
    {
      class: `card${task.status === "done" ? " done" : ""}`,
      draggable: "true",
      "aria-label": `${task.id} ${task.title}`,
      onclick: () => openTask(task.id),
    },
    el(
      "div",
      { class: "card-top" },
      el("span", {}, task.id),
      prio(task.priority),
    ),
    el("div", { class: "card-title" }, task.title),
    el(
      "div",
      { class: "card-meta" },
      dueTag(task),
      ...task.labels.slice(0, 3).map((l) => el("span", { class: "tag" }, l)),
      avatar(task.owner, "sm"),
    ),
  );
  c.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", task.id);
    c.classList.add("dragging");
  });
  c.addEventListener("dragend", () => c.classList.remove("dragging"));
  return c;
}

function skeletonBoard() {
  return el(
    "section",
    { class: "board" },
    ...COLUMNS.map(() =>
      el(
        "div",
        { class: "col" },
        el("div", { class: "col-head" }, " "),
        el(
          "div",
          { class: "cards" },
          el("div", { class: "skeleton" }),
          el("div", { class: "skeleton" }),
        ),
      ),
    ),
  );
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
  const s = document.getElementById("sync");
  if (!s) return;
  s.className = `sync${state.synced ? "" : " stale"}`;
  s.textContent = state.synced ? "Live" : "Reconnecting";
}

function feedPanel() {
  const panel = el("aside", {
    class: `feed${state.feedOpen ? " open" : " hidden"}`,
    id: "feed",
    "aria-label": "Recent activity",
  });
  fillFeed(panel);
  return panel;
}

function renderFeed() {
  const panel = document.getElementById("feed");
  if (panel) fillFeed(panel);
}

function fillFeed(panel) {
  panel.replaceChildren(
    el("h2", {}, "Recent activity"),
    ...(state.feed.length
      ? state.feed.map((f) =>
          el(
            "div",
            { class: "feed-row" },
            f.avatar
              ? el(
                  "span",
                  { class: "avatar sm" },
                  el("img", { src: f.avatar, alt: f.who }),
                )
              : avatar(f.who, "sm"),
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
      : [
          el(
            "p",
            { class: "hint" },
            "No changes yet. Edits from the board and the team CLI show up here.",
          ),
        ]),
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

  const title = el("input", {
    class: "title-input",
    value: task.title,
    "aria-label": "Title",
    maxlength: "200",
  });
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
    value: task.due,
    "aria-label": "Due date",
  });
  const labels = el("input", {
    class: "field",
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
  const saveHint = el("span", { class: "hint" }, "");
  const save = el(
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

  save.addEventListener("click", async () => {
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
    if (changes.title === "") {
      title.focus();
      saveHint.textContent = "A task needs a title";
      return;
    }
    save.disabled = true;
    saveHint.textContent = "Saving";
    const ok = await patch(task.id, changes);
    save.disabled = false;
    state.dirty = !ok;
    if (ok) {
      state.askProof = false;
      renderDrawer();
      toast(`${task.id} saved`);
    } else saveHint.textContent = "Not saved";
  });

  const comment = el("input", {
    class: "field",
    placeholder: "Add a comment",
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
        ? el(
            "li",
            {},
            el("b", {}, m[2]),
            " ",
            m[3],
            el("span", { class: "hint" }, ` · ${m[1]}`),
          )
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
      el("span", { class: `status-dot s-${task.status}` }),
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
        ...prop("Owner", owner),
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
                icon: "link",
              },
              " Open proof",
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
      save,
    ),
  );

  const root = el(
    "div",
    { id: "drawer-root" },
    el("div", { class: "scrim", onclick: () => tryClose() }),
    drawer,
  );
  document.body.append(root);
  if (!state.askProof) title.focus({ preventScroll: true });
}

function tryClose() {
  if (state.dirty && !confirm("Discard unsaved changes?")) return;
  closeDrawer();
}

// ---------- create ----------

function openCreate(status = "todo") {
  if (typeof status !== "string") status = "todo";
  document.getElementById("dialog-root")?.remove();
  const title = el("input", {
    class: "field",
    placeholder: "What needs doing",
    "aria-label": "Title",
    maxlength: "200",
    required: true,
  });
  const owner = el(
    "select",
    { class: "field", "aria-label": "Owner" },
    el("option", { value: "" }, "Unassigned"),
    ...state.board.members.map((m) => el("option", { value: m.name }, m.name)),
  );
  if (state.filter !== "all" && state.filter !== "unassigned")
    owner.value = state.filter;
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
  const hint = el("span", { class: "hint" }, `Lands in ${LABEL[status]}`);
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
    title,
    el("div", { class: "row" }, owner, due, priority),
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
