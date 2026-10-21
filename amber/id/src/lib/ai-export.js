/**
 * READING WHAT AN ASSISTANT GAVE SOMEBODY BACK.
 *
 * ChatGPT and Claude both let a person download their history, and the two
 * files look nothing alike. ChatGPT stores a conversation as a `mapping` of
 * message nodes keyed by id, because a conversation is a tree once you can
 * edit a turn and branch. Claude stores a flat `chat_messages` array. Both
 * change shape between export versions, and neither is documented as a
 * contract.
 *
 * So this is written to be TOLERANT RATHER THAN STRICT. A field that moved
 * should cost us that field, never the import: somebody who has waited a day
 * for an export and dragged in a 200MB zip is not going to be told the file
 * is invalid because one timestamp is a string this quarter. Every accessor
 * here has a fallback and nothing throws on a shape it does not recognize.
 *
 * WHAT COMES OUT is deliberately small: a provider, an id, a title, a time,
 * and the text, for matching only. The text is held just long enough to look
 * for people we already know and is never stored. See org-ai-import.js for
 * what is actually written, which is a reference and one line.
 */

/** The biggest export we will try to hold in memory at once. */
import { createRequire } from "node:module";

/** The biggest export we will try to hold in memory at once. */
export const MAX_EXPORT_BYTES = 200 * 1024 * 1024;

/** Text we will keep per conversation while matching. Enough to find a name. */
const MAX_TEXT = 200_000;

/**
 * Seconds, milliseconds or an ISO string, all of which appear in real files.
 *
 * ChatGPT writes float seconds; Claude writes ISO; some older ChatGPT exports
 * write null for conversations that were never titled. The 10^11 threshold
 * separates seconds from milliseconds for anything after 1973, which covers
 * every date a chat export can contain.
 */
function toDate(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    const ms = value > 1e11 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Message content, from any of the shapes either product has used. */
function textOf(message) {
  if (!message) return "";
  const c = message.content;

  // ChatGPT: { content_type: 'text', parts: [...] }. Parts can contain
  // objects for images and tool calls, which stringify to nothing useful.
  if (c && Array.isArray(c.parts)) {
    return c.parts.filter((p) => typeof p === "string").join("\n");
  }
  // Claude: content is an array of typed blocks, or text sits on the message.
  if (Array.isArray(c)) {
    return c.map((b) => (typeof b === "string" ? b : b?.text ?? "")).join("\n");
  }
  if (typeof c === "string") return c;
  if (typeof message.text === "string") return message.text;
  return "";
}

/** ChatGPT: conversations with a node mapping. */
function parseChatGpt(list) {
  const out = [];
  for (const convo of list) {
    const mapping = convo?.mapping;
    if (!mapping || typeof mapping !== "object") continue;

    const parts = [];
    for (const node of Object.values(mapping)) {
      const m = node?.message;
      if (!m) continue;
      const role = m.author?.role;
      // System turns are custom instructions repeated on every conversation.
      // Including them would make every single one "mention" whatever the
      // person put in their profile.
      if (role === "system") continue;
      const t = textOf(m);
      if (t) parts.push(t);
    }
    if (parts.length === 0) continue;

    out.push({
      provider: "chatgpt",
      id: String(convo.conversation_id ?? convo.id ?? ""),
      title: convo.title ? String(convo.title) : null,
      occurredAt: toDate(convo.update_time ?? convo.create_time),
      text: parts.join("\n").slice(0, MAX_TEXT),
    });
  }
  return out;
}

/** Claude: conversations with a flat message array. */
function parseClaude(list) {
  const out = [];
  for (const convo of list) {
    const messages = convo?.chat_messages;
    if (!Array.isArray(messages)) continue;

    const parts = [];
    for (const m of messages) {
      const t = textOf(m);
      if (t) parts.push(t);
    }
    if (parts.length === 0) continue;

    out.push({
      provider: "claude",
      id: String(convo.uuid ?? convo.id ?? ""),
      title: convo.name ? String(convo.name) : null,
      occurredAt: toDate(convo.updated_at ?? convo.created_at),
      text: parts.join("\n").slice(0, MAX_TEXT),
    });
  }
  return out;
}

/**
 * Which product wrote this, decided from the data rather than the filename.
 *
 * A person renames a download, or unzips it and uploads the json, or has a
 * file from a year ago. The shape is the only thing that reliably says what
 * it is, and both shapes have a field the other never has.
 */
export function detectProvider(list) {
  if (!Array.isArray(list)) return null;
  for (const convo of list.slice(0, 50)) {
    if (convo && typeof convo === "object") {
      if (convo.mapping) return "chatgpt";
      if (Array.isArray(convo.chat_messages)) return "claude";
    }
  }
  return null;
}

/**
 * Parse a conversations.json into a flat list of conversations.
 *
 * Returns { provider, conversations, skipped }. `skipped` is conversations
 * the file contained that produced no usable text -- empty threads, image-only
 * exchanges -- counted rather than dropped silently, because "we read 4,000
 * and used 1,200" is a sentence somebody will want on the screen.
 */
export function parseExport(json) {
  let list = json;

  // Some exports wrap the array; some tools re-export it under a key.
  if (!Array.isArray(list) && list && typeof list === "object") {
    list = list.conversations ?? list.data ?? list.items ?? null;
  }
  if (!Array.isArray(list)) {
    return { provider: null, conversations: [], skipped: 0, error: "not_a_conversation_export" };
  }

  const provider = detectProvider(list);
  if (!provider) {
    return { provider: null, conversations: [], skipped: 0, error: "unrecognized_format" };
  }

  const conversations = provider === "chatgpt" ? parseChatGpt(list) : parseClaude(list);
  return {
    provider,
    conversations,
    skipped: list.length - conversations.length,
  };
}

/**
 * Pull conversations.json out of an export zip.
 *
 * Both products ship a zip with several files in it; only one matters. Named
 * rather than guessed by position, and matched loosely because the path
 * inside the archive has had a folder prefix in some versions.
 */
/** How many files one upload may turn into, and how big each may be. */
const MAX_DOCS = 400;
const MAX_DOC_CHARS = 60_000;
/** An artifact is a whole running page, so it gets more room than a note. */
const MAX_ARTIFACT_CHARS = 400_000;
/** Below this a file is a stub, a link, or somebody's empty daily note. */
const MIN_DOC_CHARS = 80;

/** The last real segment of a folder path, turned into a title. */
export function folderName(dir) {
  const parts = String(dir ?? "")
    .split("/")
    .filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;
  const words = last.replace(/[-_]+/g, " ").trim();
  if (!words) return null;
  // Title case, because a folder is lowercase and a heading is not.
  return words.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** A filename, without its extension or its leading path, as a title. */
export function fileTitle(path) {
  const base = String(path ?? "").split("/").pop() ?? "";
  return base.replace(/\.[a-z]+$/i, "").replace(/[-_]+/g, " ").trim() || "Untitled";
}

/**
 * A markdown H1, or the `name:` line of YAML frontmatter, if there is one.
 *
 * Preferred over the filename because a file called `2026-10-04.md` whose
 * first line is "# Paychex discovery call" has a real title in it, and the
 * date is the worse of the two.
 */
export function titleFromMarkdown(body) {
  const text = String(body ?? "");
  const front = text.match(/^---\n([\s\S]{0,800}?)\n---/);
  if (front) {
    const named = front[1].match(/^name:\s*(.+)$/m) ?? front[1].match(/^title:\s*(.+)$/m);
    if (named) {
      const v = named[1].trim().replace(/^["']|["']$/g, "");
      if (v) return v.slice(0, 160);
    }
  }
  const h1 = text.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim().slice(0, 160) || null;
  return null;
}

/** The <title> of an HTML artifact, which is the name its author gave it. */
export function titleFromHtml(body) {
  const m = String(body ?? "").match(/<title[^>]*>([^<]{1,160})<\/title>/i);
  const v = m ? m[1].trim() : "";
  if (v && !/^(document|untitled|index)$/i.test(v)) return v;
  const h1 = String(body ?? "").match(/<h1[^>]*>([^<]{1,160})<\/h1>/i);
  return h1 ? h1[1].trim() || null : null;
}

export function readExportBuffer(buffer, filename = "") {
  if (!Buffer.isBuffer(buffer)) return { error: "no_file" };
  if (buffer.length > MAX_EXPORT_BYTES) return { error: "too_large" };

  const looksZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

  if (!looksZip) {
    /*
     * A BARE ARTIFACT, DROPPED ON ITS OWN.
     *
     * The thing somebody built in Claude and now uses every day for their
     * sales motion is one HTML file. They do not have an "export" of it;
     * they have the file, and dropping it here should work. Checked before
     * the JSON parse because an artifact is not JSON and would otherwise
     * come back as "that is not a Claude export", which is true and useless.
     */
    const head = buffer.subarray(0, 600).toString("utf8").trimStart().toLowerCase();
    const named = /\.(html?|jsx|tsx|svg)$/i.test(String(filename ?? ""));
    if (named || head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<svg")) {
      const body = buffer.toString("utf8");
      if (body.trim().length >= MIN_DOC_CHARS) {
        return {
          kind: "bundle",
          projects: [],
          skills: [],
          artifacts: [
            {
              path: String(filename || "artifact.html"),
              name: titleFromHtml(body) ?? fileTitle(filename || "Artifact"),
              body: body.slice(0, MAX_ARTIFACT_CHARS),
            },
          ],
          docs: [],
          data: [],
          json: null,
          skipped: 0,
          files: 1,
        };
      }
    }

    let parsed;
    try {
      parsed = JSON.parse(buffer.toString("utf8"));
    } catch {
      return { error: "not_json" };
    }

    /*
     * THE MANIFEST IS NOT THE EXPORT, and this is the file people actually
     * receive now.
     *
     * Claude's export stopped being one zip. The email delivers a small
     * JSON listing five SEPARATE downloads -- conversations, projects,
     * memories, frames, metadata -- each with its own expiring link.
     * Somebody who follows the obvious instruction ("export your data, drop
     * the file in") drops this, and the old code read it as a conversation
     * export, found no conversations, and said the format was unrecognized.
     *
     * Which is true and useless. The file knows exactly what is missing and
     * where to get it, so the error carries that instead.
     */
    if (parsed && Array.isArray(parsed.data_files) && parsed.instructions) {
      return {
        error: "manifest_not_data",
        manifest: parsed.data_files.map((f) => ({
          category: f.category,
          filename: f.filename,
          url: f.export_url,
        })),
      };
    }

    // A bare .json, which is what somebody uploads after unzipping it
    // themselves. Also the shape a test uses.
    return { json: parsed };
  }

  // Required lazily so that a deployment which never imports an export does
  // not pay for the module, and so the parser above stays testable without it.
  let AdmZip;
  try {
    AdmZip = createRequire(import.meta.url)("adm-zip");
  } catch {
    return { error: "zip_unsupported" };
  }

  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);

    /*
     * EVERYTHING IN THE ARCHIVE, NOT THE FIRST THING THAT MATCHES.
     *
     * THE OLD BEHAVIOR AND WHY IT WAS WRONG. This returned as soon as it
     * recognized one shape: projects, else skills, else artifacts, else the
     * conversations file, else markdown. A real export is several of those
     * at once, so a zip holding thirteen projects and forty notes imported
     * thirteen things and silently dropped the forty. Nothing told anybody;
     * the count just looked low.
     *
     * The archive is read ONCE now and everything found comes back
     * together. What somebody dropped in is what lands, and the screen can
     * show them the whole inventory before they commit to any of it.
     *
     * CLAIMED FILES ARE NOT CLAIMED TWICE. A skill folder owns its own
     * files -- its SKILL.md, its scripts, its templates -- so they do not
     * also show up as loose documents and artifacts. Without that, one
     * skill with a template.md in it becomes a skill AND a stray page, and
     * the inventory stops matching the folder somebody can see.
     */
    const claimed = new Set();

    /* --- projects: one file per project, already a unit ----------------- */
    const projects = [];
    for (const e of entries.filter((x) => /(^|\/)projects\/[^/]+\.json$/i.test(x.entryName))) {
      claimed.add(e.entryName);
      try {
        projects.push(JSON.parse(e.getData().toString("utf8")));
      } catch {
        // One unreadable project must not lose the other twelve.
      }
    }

    /* --- skills: a folder with a SKILL.md, and the files beside it ------ */
    const skills = [];
    for (const e of entries.filter((x) => /(^|\/)SKILL\.(md|markdown)$/i.test(x.entryName))) {
      const dir = e.entryName.replace(/SKILL\.(md|markdown)$/i, "");
      let body;
      try {
        body = e.getData().toString("utf8");
      } catch {
        continue;
      }
      claimed.add(e.entryName);
      const siblings = entries.filter(
        (x) => x.entryName !== e.entryName && x.entryName.startsWith(dir),
      );
      for (const sib of siblings) claimed.add(sib.entryName);
      skills.push({
        path: e.entryName,
        name: titleFromMarkdown(body) ?? folderName(dir) ?? "Skill",
        body: body.slice(0, MAX_DOC_CHARS),
        files: siblings.map((x) => x.entryName.slice(dir.length)).slice(0, 60),
      });
      if (skills.length >= MAX_DOCS) break;
    }

    /* --- artifacts: things that run ------------------------------------- */
    const artifacts = [];
    for (const e of entries) {
      if (claimed.has(e.entryName)) continue;
      if (!/\.(html?|jsx|tsx|svg)$/i.test(e.entryName)) continue;
      let body;
      try {
        body = e.getData().toString("utf8");
      } catch {
        continue;
      }
      if (body.trim().length < MIN_DOC_CHARS) continue;
      claimed.add(e.entryName);
      artifacts.push({
        path: e.entryName,
        name: titleFromHtml(body) ?? fileTitle(e.entryName),
        body: body.slice(0, MAX_ARTIFACT_CHARS),
      });
      if (artifacts.length >= MAX_DOCS) break;
    }

    /* --- the conversation export, if this archive is one ---------------- */
    const convo =
      entries.find((e) => /(^|\/)conversations\.json$/i.test(e.entryName)) ??
      entries.find((e) => /(^|\/)conversations[-_]?\d*\.json$/i.test(e.entryName));
    let json = null;
    if (convo) {
      claimed.add(convo.entryName);
      try {
        json = JSON.parse(convo.getData().toString("utf8"));
      } catch {
        json = null;
      }
    }

    /* --- writing: an Obsidian vault, a notes folder, anything ----------- */
    const docs = [];
    for (const e of entries) {
      if (claimed.has(e.entryName)) continue;
      if (!/\.(md|markdown|txt)$/i.test(e.entryName)) continue;
      let body;
      try {
        body = e.getData().toString("utf8");
      } catch {
        continue;
      }
      if (body.trim().length < MIN_DOC_CHARS) continue;
      claimed.add(e.entryName);
      docs.push({
        path: e.entryName,
        name: titleFromMarkdown(body) ?? fileTitle(e.entryName),
        body: body.slice(0, MAX_DOC_CHARS),
      });
      if (docs.length >= MAX_DOCS) break;
    }

    /*
     * --- and whatever else is JSON ---------------------------------------
     *
     * Memories, frames, settings, the metadata file. These are nobody's
     * idea of a document and they are still THEIR data, and the instruction
     * was that everything in the zip comes through. They are kept verbatim
     * in a fenced block, which is honest: it is a record, not a page, and
     * dressing it up as prose would be inventing something.
     */
    const data = [];
    for (const e of entries) {
      if (claimed.has(e.entryName)) continue;
      if (!/\.(json|csv|yaml|yml)$/i.test(e.entryName)) continue;
      let body;
      try {
        body = e.getData().toString("utf8");
      } catch {
        continue;
      }
      if (body.trim().length < MIN_DOC_CHARS) continue;
      claimed.add(e.entryName);
      data.push({
        path: e.entryName,
        name: fileTitle(e.entryName),
        body: body.slice(0, MAX_DOC_CHARS),
      });
      if (data.length >= MAX_DOCS) break;
    }

    const found =
      projects.length + skills.length + artifacts.length + docs.length + data.length;
    if (found === 0 && !json) return { error: "no_conversations_json", filename };

    return {
      kind: "bundle",
      projects,
      skills,
      artifacts,
      docs,
      data,
      json,
      /*
       * WHAT WAS IN THERE AND WAS NOT TAKEN -- images, binaries, fonts.
       * Counted rather than hidden, because "47 files, 39 imported" lets
       * somebody ask about the other eight, and a silent drop does not.
       */
      skipped: entries.filter((e) => !claimed.has(e.entryName)).length,
      files: entries.length,
    };
  } catch {
    return { error: "bad_zip" };
  }
}
