/**
 * A CLAUDE PROJECT IS ALREADY THE THING PEOPLE WANT TO SHARE.
 *
 * WHAT IS ACTUALLY IN THE EXPORT, which is better than I expected. Each
 * project is its own JSON file -- `projects/<uuid>.json` -- carrying a name,
 * a description, the custom instructions somebody wrote for it, and the list
 * of documents they attached. Thirteen of them in one real account:
 * "Amber Development" with 58 docs and a page of instructions, "Clay
 * Outbound", "48North Prompt Engineering", "Karthik's Business Landscape".
 *
 * That is not raw material that needs distilling. It is already the unit:
 * somebody built it deliberately, named it, wrote instructions for it, and
 * uses it to do a job. The thing a team wants is exactly this, handed over
 * whole -- the instructions above all, because that is the part that took
 * the thinking and the part nobody can reconstruct from a transcript.
 *
 * SO PROJECTS ARE NOT TREATED LIKE CONVERSATIONS. The conversation importer
 * hunts for documents inside chat logs and has to guess what counts. Here
 * there is nothing to guess: one project in, one page out, with its
 * instructions and its document list intact.
 *
 * WHAT THE EXPORT DOES NOT CONTAIN, said plainly because a page that implies
 * otherwise would be a lie: the documents' CONTENT is not in this file. Each
 * doc carries a uuid, a filename and a date. So the page lists what is in
 * the project and cannot reproduce it, which is still most of the value --
 * "Amber Development has these 58 documents and these instructions" is a
 * thing a colleague can act on, and pretending to hold the text would be
 * worse than naming it.
 */

import { createPage } from "./org-knowledge-store.js";
import { query } from "./sql.js";

/** A project with nothing in it is a folder somebody made and abandoned. */
const MIN_SUBSTANCE = 40;

export function projectKey(uuid) {
  return `ai:project:${uuid}`;
}

/**
 * Is this JSON one project from the export?
 *
 * Keyed on the fields that only a project has. `docs` alone would also match
 * half a dozen other shapes, and `name` matches almost anything.
 */
export function looksLikeProject(json) {
  return Boolean(
    json &&
      typeof json === "object" &&
      !Array.isArray(json) &&
      typeof json.uuid === "string" &&
      typeof json.name === "string" &&
      ("docs" in json || "prompt_template" in json),
  );
}

/**
 * The page body for one project.
 *
 * WRITTEN AS SOMETHING A COLLEAGUE READS, not as a dump of the JSON. The
 * instructions come first and verbatim, because they are the part that took
 * the thinking; the document list is a list; and what is missing is said
 * once, at the bottom, rather than left for somebody to discover by clicking
 * a filename that does not open.
 */
export function projectBody(p) {
  const out = [];

  if (p.description?.trim()) out.push(p.description.trim(), "");

  if (p.prompt_template?.trim()) {
    out.push("## Instructions", "");
    out.push(p.prompt_template.trim(), "");
  }

  const docs = Array.isArray(p.docs) ? p.docs : [];
  if (docs.length > 0) {
    out.push(`## Documents (${docs.length})`, "");
    for (const d of docs) {
      const when = d?.created_at ? String(d.created_at).slice(0, 10) : null;
      out.push(`- ${d?.filename ?? "Untitled"}${when ? ` · ${when}` : ""}`);
    }
    out.push("");
    out.push(
      "_Claude's export lists these documents by name and date; their contents are not " +
        "included in it. Attach the files here to make them readable._",
    );
  }

  return out.join("\n").trim();
}

/** Enough to be worth a page? */
export function projectSubstance(p) {
  const docs = Array.isArray(p.docs) ? p.docs.length : 0;
  const instructions = (p.prompt_template ?? "").trim().length;
  const description = (p.description ?? "").trim().length;
  // Instructions count for a lot: a project with a page of them and no docs
  // is somebody's working method written down, which is the whole point.
  return docs * 20 + instructions + description;
}

/**
 * Turn every project in an export into a page, privately.
 *
 * Same contract as distillKnowledge: a dry run lists what it would make and
 * writes nothing, and `reach` says who each one is for -- "private" (the
 * default), "company", or a circle's id.
 */
export async function importProjects({
  orgId,
  amberId,
  projects = [],
  dryRun = true,
  reach = {},
} = {}) {
  if (!orgId || !amberId) return { ok: false, reason: "bad_input" };

  const usable = projects
    .filter(looksLikeProject)
    .filter((p) => projectSubstance(p) >= MIN_SUBSTANCE)
    .sort((a, b) => projectSubstance(b) - projectSubstance(a));

  const keys = usable.map((p) => projectKey(p.uuid));
  const { rows: existing } = keys.length
    ? await query(`SELECT tags FROM org_pages WHERE org_id = $1::uuid AND tags && $2::text[]`, [
        orgId,
        keys,
      ])
    : { rows: [] };
  const seen = new Set(existing.flatMap((r) => r.tags ?? []).filter((t) => t.startsWith("ai:")));

  const fresh = usable.filter((p) => !seen.has(projectKey(p.uuid)));

  const preview = fresh.map((p) => ({
    id: p.uuid,
    title: p.name,
    at: p.updated_at ?? p.created_at ?? null,
    docs: Array.isArray(p.docs) ? p.docs.length : 0,
    hasInstructions: Boolean((p.prompt_template ?? "").trim()),
    description: (p.description ?? "").trim().slice(0, 200) || null,
  }));

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      considered: projects.length,
      found: usable.length,
      alreadyHere: usable.length - fresh.length,
      wouldCreate: fresh.length,
      preview,
    };
  }

  let created = 0;
  const made = [];
  for (const p of fresh) {
    const out = await createPage({
      orgId,
      title: String(p.name).slice(0, 160),
      body: projectBody(p),
      summary: (p.description ?? "").trim().slice(0, 500) || null,
      kind: "page",
      createdBy: amberId,
      tags: [projectKey(p.uuid), "from:claude-project"],
      audience: audienceFor(reach[p.uuid], amberId),
    }).catch((err) => ({ ok: false, reason: String(err?.message ?? err) }));

    if (out?.ok && out.page) {
      created += 1;
      made.push({ id: out.page.id, slug: out.page.slug, title: out.page.title });
    }
  }

  return {
    ok: true,
    dryRun: false,
    considered: projects.length,
    found: usable.length,
    alreadyHere: usable.length - fresh.length,
    created,
    pages: made,
  };
}

/**
 * ANYTHING UNRECOGNIZED IS PRIVATE. Same reasoning as the conversation
 * importer: the failure modes are not symmetrical, and treating an unknown
 * value as "company" publishes somebody's working method on a guess.
 */
function audienceFor(choice, amberId) {
  if (choice === "company") return { everyone: true };
  if (typeof choice === "string" && /^[0-9a-f-]{36}$/i.test(choice)) {
    return { everyone: false, groups: [choice] };
  }
  return { everyone: false, people: [amberId] };
}

export const __test = { looksLikeProject, projectSubstance, projectBody, projectKey };

/**
 * SKILLS AND LOOSE DOCUMENTS, THROUGH THE SAME DOOR.
 *
 * WHY THIS EXISTS. Projects were the first shape worth importing and they
 * are not the only one. The thing Jason actually described -- a folder in
 * Obsidian holding the skills and small tools that make him better at his
 * job, handed to his team one piece at a time -- is a directory of markdown,
 * and refusing it because it is not a Claude export would be the product
 * failing at exactly the use case it was built for.
 *
 * A SKILL KEEPS ITS SHAPE. A folder with a SKILL.md in it already is the
 * unit: it has a name, it has instructions, and it has the files it needs.
 * Those files' CONTENTS are not pulled in -- a script is not a page -- but
 * they are listed, because a skill that quietly arrives without its script
 * is worse than one that says what is missing.
 *
 * EVERYTHING ELSE IS JUST THE FILE. The title is the H1 or the frontmatter
 * name, falling back to the filename; the body is the file. Nothing is
 * summarized and nothing is inferred, because the person wrote it already
 * and a paraphrase of their own notes is not a feature.
 */
const TAG = {
  skill: "from:skill",
  artifact: "from:artifact",
  data: "from:data",
  doc: "from:import",
};

/**
 * AN ARTIFACT IS KEPT AS SOURCE, IN A FENCE, AND NOT TOUCHED.
 *
 * Somebody built a thing in Claude that they run every day for their sales
 * motion. What their team needs is THE THING, able to run, not a description
 * of it -- so the page carries the file exactly as written, and the viewer
 * is what decides whether to render it or show the code. Editing, prettying
 * or extracting here would be the one way to break something that worked.
 *
 * The fence is what marks it: a page whose body is one ```html block is a
 * page the viewer can offer to run, and a page of prose is not.
 */
function bodyFor(kind, item) {
  if (kind === "skill") return skillBody(item);
  if (kind === "artifact") {
    const lang = /\.svg$/i.test(item.path) ? "svg" : /\.[jt]sx$/i.test(item.path) ? "jsx" : "html";
    return ["```" + lang, String(item.body ?? "").trim(), "```"].join("\n");
  }
  if (kind === "data") {
    /*
     * A RECORD, KEPT AS A RECORD. Memories, frames, settings -- nobody's
     * idea of a page, and still theirs. Fenced rather than reflowed,
     * because prettying a data file into prose invents a document that
     * does not exist.
     */
    const lang = /\.csv$/i.test(item.path) ? "csv" : /\.ya?ml$/i.test(item.path) ? "yaml" : "json";
    return ["```" + lang, String(item.body ?? "").trim(), "```"].join("\n");
  }
  return String(item.body ?? "").trim();
}

export function documentKey(kind, path) {
  return `ai:${kind}:${String(path).slice(0, 180)}`;
}

/** The page body for one skill: its own text, then what came with it. */
export function skillBody(s) {
  const out = [String(s.body ?? "").trim()];
  const files = Array.isArray(s.files) ? s.files.filter(Boolean) : [];
  if (files.length > 0) {
    out.push("", `## Files in this skill (${files.length})`, "");
    for (const f of files.slice(0, 60)) out.push(`- ${f}`);
    out.push("");
    out.push("_These came with the skill. Attach them here to make them readable._");
  }
  return out.join("\n").trim();
}

/**
 * Import skills or documents as pages.
 *
 * Same contract as importProjects on purpose: a dry run lists what it would
 * make and writes nothing, `reach` says who each one is for, and anything
 * already here is left alone rather than duplicated.
 */
export async function importDocuments({
  orgId,
  amberId,
  items = [],
  kind = "doc",
  dryRun = true,
  reach = {},
} = {}) {
  if (!orgId || !amberId) return { ok: false, reason: "bad_input" };

  const usable = items.filter((i) => i && i.path && String(i.body ?? "").trim().length > 0);

  const keys = usable.map((i) => documentKey(kind, i.path));
  const { rows: existing } = keys.length
    ? await query(`SELECT tags FROM org_pages WHERE org_id = $1::uuid AND tags && $2::text[]`, [
        orgId,
        keys,
      ])
    : { rows: [] };
  const seen = new Set(existing.flatMap((r) => r.tags ?? []).filter((t) => t.startsWith("ai:")));

  const fresh = usable.filter((i) => !seen.has(documentKey(kind, i.path)));

  const preview = fresh.map((i) => ({
    id: i.path,
    title: i.name,
    at: null,
    docs: Array.isArray(i.files) ? i.files.length : 0,
    hasInstructions: kind === "skill",
    description: String(i.body ?? "")
      .replace(/^---[\s\S]*?---\s*/, "")
      .replace(/^#.*$/m, "")
      .trim()
      .slice(0, 200) || null,
  }));

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      considered: items.length,
      found: usable.length,
      alreadyHere: usable.length - fresh.length,
      wouldCreate: fresh.length,
      preview,
    };
  }

  let created = 0;
  const made = [];
  for (const i of fresh) {
    const out = await createPage({
      orgId,
      title: String(i.name ?? "Untitled").slice(0, 160),
      body: bodyFor(kind, i),
      summary: null,
      kind: "page",
      createdBy: amberId,
      tags: [documentKey(kind, i.path), TAG[kind] ?? "from:import"],
      audience: audienceFor(reach[i.path], amberId),
    }).catch((err) => ({ ok: false, reason: String(err?.message ?? err) }));

    if (out?.ok && out.page) {
      created += 1;
      made.push({ id: out.page.id, slug: out.page.slug, title: out.page.title });
    }
  }

  return {
    ok: true,
    dryRun: false,
    considered: items.length,
    found: usable.length,
    alreadyHere: usable.length - fresh.length,
    created,
    pages: made,
  };
}
