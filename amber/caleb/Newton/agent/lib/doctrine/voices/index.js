/**
 * Voice-card loader for the newsletter editor.
 *
 * Tab 12 of the 2026-05-28 dispatch.
 *
 * Resolution order for `loadVoiceCard(authorSlug, ctx)`:
 *
 *   1. Tab 11's `recall_author_voice` tool (per-tenant Firestore via medha-id).
 *      Renders the structured profile into a markdown block at runtime.
 *   2. Bundled `<slug>.md` file shipped in this directory.
 *   3. Throw a clear error so the caller can surface "I don't know this
 *      author's voice yet — paste 1-2 samples."
 *
 * The fallback chain is INTENTIONAL per the dispatch's parallel-tab fallback
 * strategy: Tab 11 may not have merged when Tab 12 runs in production. Once
 * Tab 11 lands and Caleb runs `track_author_voice` for Sagar, this loader
 * starts hitting Firestore and the bundled .md becomes seed-only.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a voice card for the given author slug. Returns a markdown string
 * ready to drop into a system prompt.
 *
 * @param {string} authorSlug — lowercase-hyphenated (e.g. "sagar-tiwari").
 * @param {object} [ctx]
 * @param {object} [ctx.tenant] — passed through to `recall_author_voice`
 *   when Tab 11 is wired.
 * @param {function} [ctx.recallAuthorVoice] — injected for tests. When
 *   absent, the loader tries to import the real tool; when that tool isn't
 *   on the surface yet (Tab 11 unmerged), it falls through to the bundled
 *   .md file.
 * @returns {Promise<string>} markdown voice card.
 */
export async function loadVoiceCard(authorSlug, ctx = {}) {
  const slug = normalizeSlug(authorSlug);
  if (!slug) {
    throw new Error(
      "loadVoiceCard: author_slug is required (lowercase-hyphenated).",
    );
  }

  const firestore = await tryFirestore(slug, ctx);
  if (firestore) return firestore;

  const bundled = await tryBundled(slug);
  if (bundled) return bundled;

  throw new Error(
    `loadVoiceCard: no voice card found for "${slug}". ` +
      "Either run track_author_voice (Tab 11) to seed Firestore, or paste " +
      "1-2 sample pieces and call edit_for_newsletter again with the samples " +
      "inline in the source.",
  );
}

function normalizeSlug(slug) {
  if (!slug || typeof slug !== "string") return null;
  return slug
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

async function tryFirestore(slug, ctx) {
  const recall = ctx?.recallAuthorVoice || (await tryImportRecallTool());
  if (!recall) return null;

  let profile;
  try {
    profile = await recall({ author_slug: slug }, { tenant: ctx?.tenant });
  } catch {
    return null;
  }
  if (!profile || profile.error || profile.found === false) return null;

  return renderProfileToMarkdown(profile);
}

async function tryImportRecallTool() {
  try {
    const mod = await import("../../tools/personal-life.js");
    if (typeof mod.recallAuthorVoice === "function") {
      return mod.recallAuthorVoice;
    }
  } catch {
    // Tab 11 hasn't merged. Fall through.
  }
  return null;
}

async function tryBundled(slug) {
  try {
    const path = join(__dirname, `${slug}.md`);
    const raw = await readFile(path, "utf8");
    return stripFrontmatter(raw);
  } catch {
    return null;
  }
}

function stripFrontmatter(md) {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return md;
  return md.slice(end + 4).replace(/^\n+/, "");
}

/**
 * Render a Tab 11 author-voice Firestore row into a markdown block. The
 * shape matches the dispatch spec for `agent_data/{did}/author_voices/{slug}`.
 */
function renderProfileToMarkdown(p) {
  const lines = [];
  lines.push(`# ${p.display_name || p.author_slug} — voice card`);
  if (p.role_at_org || p.org) {
    lines.push("");
    lines.push(`Role: ${[p.role_at_org, p.org].filter(Boolean).join(" / ")}`);
  }
  const v = p.voice_tells || {};
  if (Object.keys(v).length) {
    lines.push("");
    lines.push("## Voice tells");
    if (v.sentence_rhythm) lines.push(`- Rhythm: ${v.sentence_rhythm}`);
    if (v.vocabulary_tells) lines.push(`- Vocabulary: ${v.vocabulary_tells}`);
    if (v.opener_patterns) lines.push(`- Openers: ${v.opener_patterns}`);
    if (v.closer_patterns) lines.push(`- Closers: ${v.closer_patterns}`);
    if (Array.isArray(v.signature_phrases) && v.signature_phrases.length) {
      lines.push(`- Signature phrases: ${v.signature_phrases.join(", ")}`);
    }
    if (Array.isArray(v.jargon_blacklist) && v.jargon_blacklist.length) {
      lines.push(`- Jargon blacklist: ${v.jargon_blacklist.join(", ")}`);
    }
  }
  if (Array.isArray(p.what_they_dont_say) && p.what_they_dont_say.length) {
    lines.push("");
    lines.push("## What they do not say");
    p.what_they_dont_say.forEach((s) => lines.push(`- ${s}`));
  }
  if (Array.isArray(p.sample_pieces) && p.sample_pieces.length) {
    lines.push("");
    lines.push("## Sample pieces");
    p.sample_pieces.forEach((s, i) => {
      const title = s.title || `Sample ${i + 1}`;
      lines.push(`### ${title}`);
      if (s.body) lines.push(s.body);
      lines.push("");
    });
  }
  return lines.join("\n");
}
