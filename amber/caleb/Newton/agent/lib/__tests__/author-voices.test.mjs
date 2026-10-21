/**
 * Tests for the per-author voice models added in Tab 11.
 *
 * Covers:
 *   - writing/author-voices.js loader: Firestore-first, bundled-seed fallback
 *   - tools/personal-life.js author-voice handler dispatch + error shapes
 *   - voice-guard integration on draft output
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/author-voices.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  loadAuthorVoice,
  AUTHOR_VOICE_SEED,
  slugify,
} from "../writing/author-voices.js";
import {
  PERSONAL_LIFE_TOOLS,
  executePersonalLifeTool,
} from "../tools/personal-life.js";

// ── writing/author-voices.js ─────────────────────────────────────────────

test("slugify matches medha-id slugifyForId semantics", () => {
  assert.equal(slugify("Sagar Tiwari"), "sagar-tiwari");
  assert.equal(slugify("CALEB NEWTON!!"), "caleb-newton");
  assert.equal(slugify("---hello---"), "hello");
  assert.equal(slugify(""), "");
});

test("AUTHOR_VOICE_SEED contains a Sagar profile with voice tells", () => {
  const sagar = AUTHOR_VOICE_SEED["sagar-tiwari"];
  assert.ok(sagar);
  assert.equal(sagar.display_name, "Sagar Tiwari");
  assert.equal(sagar.org, "bma");
  assert.ok(sagar.voice_tells.closer_patterns.includes("My bet is"));
  assert.ok(sagar.voice_tells.jargon_blacklist.includes("leverage"));
});

test("loadAuthorVoice falls back to bundled seed when amber-id is absent", async () => {
  // No phone passed -> amber-id fetch short-circuits to null -> seed wins.
  const profile = await loadAuthorVoice({
    phone: null,
    authorSlug: "Sagar Tiwari",
  });
  assert.ok(profile);
  assert.equal(profile.author_slug, "sagar-tiwari");
  assert.equal(profile.source, "bundled_seed");
});

test("loadAuthorVoice returns null for unknown author with no seed entry", async () => {
  const profile = await loadAuthorVoice({
    phone: null,
    authorSlug: "ghost-author-nobody-knows",
  });
  assert.equal(profile, null);
});

test("loadAuthorVoice returns null when slug is empty", async () => {
  const profile = await loadAuthorVoice({ phone: null, authorSlug: "" });
  assert.equal(profile, null);
});

// ── tool schema sanity ───────────────────────────────────────────────────

test("PERSONAL_LIFE_TOOLS exposes the 3 new author-voice tools", () => {
  const names = PERSONAL_LIFE_TOOLS.map((t) => t.name);
  for (const name of [
    "track_author_voice",
    "recall_author_voice",
    "draft_in_author_voice",
  ]) {
    assert.ok(names.includes(name), `missing tool: ${name}`);
  }
});

test("track_author_voice schema requires display_name", () => {
  const tool = PERSONAL_LIFE_TOOLS.find((t) => t.name === "track_author_voice");
  assert.deepEqual(tool.input_schema.required, ["display_name"]);
});

test("draft_in_author_voice schema requires author_slug", () => {
  const tool = PERSONAL_LIFE_TOOLS.find(
    (t) => t.name === "draft_in_author_voice",
  );
  assert.deepEqual(tool.input_schema.required, ["author_slug"]);
});

// ── dispatcher behavior ──────────────────────────────────────────────────

test("recall_author_voice returns the bundled seed when no Firestore row exists", async () => {
  const result = await executePersonalLifeTool(
    "recall_author_voice",
    { author_slug: "sagar-tiwari" },
    { tenant: { phoneNumber: null } },
  );
  assert.equal(result.success, true);
  assert.equal(result.found, true);
  assert.equal(result.source, "bundled_seed");
  assert.equal(result.author_voice.display_name, "Sagar Tiwari");
});

test("recall_author_voice reports not-found cleanly for unknown authors", async () => {
  const result = await executePersonalLifeTool(
    "recall_author_voice",
    { author_slug: "nobody-on-file" },
    { tenant: { phoneNumber: null } },
  );
  assert.equal(result.success, true);
  assert.equal(result.found, false);
  assert.ok(result.message);
});

test("recall_author_voice errors when slug is missing", async () => {
  const result = await executePersonalLifeTool(
    "recall_author_voice",
    {},
    { tenant: { phoneNumber: null } },
  );
  assert.equal(result.error, "author_slug_required");
});

test("draft_in_author_voice errors when source is missing", async () => {
  const result = await executePersonalLifeTool(
    "draft_in_author_voice",
    { author_slug: "sagar-tiwari" },
    { tenant: { phoneNumber: null } },
  );
  assert.equal(result.error, "source_required");
});

test("draft_in_author_voice errors when author is unknown", async () => {
  const result = await executePersonalLifeTool(
    "draft_in_author_voice",
    {
      author_slug: "ghost-author-nobody-knows",
      source_brief: "test brief",
    },
    { tenant: { phoneNumber: null } },
  );
  assert.equal(result.error, "author_voice_not_found");
});

test("draft_in_author_voice errors cleanly when ANTHROPIC_API_KEY is missing", async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const result = await executePersonalLifeTool(
      "draft_in_author_voice",
      {
        author_slug: "sagar-tiwari",
        source_brief:
          "Talking points about why ignoring AI hype is its own edge.",
      },
      { tenant: { phoneNumber: null } },
    );
    assert.equal(result.error, "anthropic_api_key_missing");
  } finally {
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  }
});

test("track_author_voice errors when amber-id is not configured", async () => {
  // No AMBER_ID_API_URL / AMBER_ID_API_KEY in the test env -> configured()
  // returns false and the handler returns the configured error.
  const result = await executePersonalLifeTool(
    "track_author_voice",
    {
      display_name: "Test Author",
      voice_tells: { sentence_rhythm: "short, punchy" },
    },
    { tenant: { phoneNumber: "+15555550100" } },
  );
  assert.equal(result.error, "amber_id_not_configured");
});
