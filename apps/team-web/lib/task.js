// Task file format. tools/team.py is the other half and must agree byte for
// byte: the CLI and this site write the same files on the same branch, and
// tests/test_team_web.sh round-trips one file through both parsers.

export const FIELDS = [
  "id",
  "title",
  "status",
  "owner",
  "priority",
  "due",
  "labels",
  "done_when",
  "proof",
  "created",
  "updated",
];
export const STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
];
export const PRIORITIES = ["urgent", "high", "medium", "low", "none"];
export const ID_PATTERN = /^CHW-(\d+)$/;

// Terminal control bytes, minus tab and newline: see CONTROL in tools/team.py.
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;
export const clean = (value) => String(value ?? "").replace(CONTROL, "");

export function oneLine(value) {
  return clean(value).replace(/\s+/g, " ").trim();
}

// See safe_notes in tools/team.py: a bare "## Activity" line inside notes
// would split the file and forge activity entries.
export function safeNotes(notes) {
  return clean(notes).trim().split("\n").map((l) => (l.trim() === "## Activity" ? "### Activity" : l)).join("\n");
}

export function parse(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (!lines.length || lines[0].trim() !== "---")
    throw new Error("task file has no frontmatter");
  const meta = {};
  let i = 1;
  for (; i < lines.length && lines[i].trim() !== "---"; i++) {
    const at = lines[i].indexOf(":");
    if (at >= 0)
      meta[lines[i].slice(0, at).trim()] = lines[i].slice(at + 1).trim();
  }
  if (i >= lines.length) throw new Error("task frontmatter is not closed");
  const body = lines
    .slice(i + 1)
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
  const task = Object.fromEntries(FIELDS.map((f) => [f, meta[f] ?? ""]));
  task.labels = task.labels
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  let notes = body;
  let activity = "";
  if (body.startsWith("## Activity\n")) {
    notes = "";
    activity = body.slice("## Activity\n".length);
  } else {
    const at = body.indexOf("\n## Activity\n");
    if (at >= 0) {
      notes = body.slice(0, at);
      activity = body.slice(at + "\n## Activity\n".length);
    }
  }
  task.notes = notes.trim();
  task.activity = activity
    .trim()
    .split("\n")
    .filter((a) => a.startsWith("- "))
    .map((a) => a.slice(2));
  return task;
}

export function render(task) {
  const out = ["---"];
  for (const f of FIELDS) {
    const v = f === "labels" ? (task.labels || []).join(", ") : task[f];
    out.push(`${f}: ${oneLine(v)}`);
  }
  out.push("---");
  if (task.notes) out.push("", safeNotes(task.notes));
  out.push(
    "",
    "## Activity",
    ...(task.activity || []).map((a) => `- ${oneLine(a)}`),
  );
  return out.join("\n") + "\n";
}

export function idNumber(id) {
  const m = ID_PATTERN.exec(id || "");
  return m ? Number(m[1]) : 0;
}
