import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SHIRLEY_RULES,
  CRITIQUE_RUBRIC,
  MIN_PASS_SCORE,
  MAX_REVISIONS,
  DRAFT_SYSTEM_PROMPT_TEMPLATE,
  REVISION_PROMPT_TEMPLATE,
  critiquePasses,
} from "../doctrine/newsletter.js";

import {
  NEWSLETTER_EDITOR_TOOLS,
  executeNewsletterEditorTool,
} from "../tools/newsletter-editor.js";

// ---- Doctrine constants ---------------------------------------------------

test("SHIRLEY_RULES contains all 4 rules with attribution", () => {
  for (const fragment of [
    "1. Write from the author's perspective",
    "2. Every piece stands alone",
    "3. If a story can't land fully, cut it",
    "4. The argument is clear and compelling",
    "editorial review 2026-05-27",
  ]) {
    assert.ok(
      SHIRLEY_RULES.includes(fragment),
      `SHIRLEY_RULES missing fragment: ${fragment}`,
    );
  }
});

test("CRITIQUE_RUBRIC enumerates all 4 scoring dimensions", () => {
  for (const dim of [
    "voice_match",
    "stands_alone",
    "story_completeness",
    "argument_clarity",
  ]) {
    assert.ok(
      CRITIQUE_RUBRIC.includes(dim),
      `CRITIQUE_RUBRIC missing dimension: ${dim}`,
    );
  }
});

test("MIN_PASS_SCORE is 8 (strict mode per dispatch Q7)", () => {
  assert.equal(MIN_PASS_SCORE, 8);
});

test("MAX_REVISIONS is 2 (dispatch contract)", () => {
  assert.equal(MAX_REVISIONS, 2);
});

test("DRAFT_SYSTEM_PROMPT_TEMPLATE embeds all 4 Shirley rules and the voice card", () => {
  const prompt = DRAFT_SYSTEM_PROMPT_TEMPLATE({
    voiceCard: "## TEST VOICE CARD\n- Specific tells\n",
    targetWords: 400,
    format: "newsletter",
  });
  assert.ok(prompt.includes("1. Write from the author's perspective"));
  assert.ok(prompt.includes("2. Every piece stands alone"));
  assert.ok(prompt.includes("3. If a story can't land fully"));
  assert.ok(prompt.includes("4. The argument is clear"));
  assert.ok(prompt.includes("## TEST VOICE CARD"));
  assert.ok(prompt.includes("400 words"));
});

test("critiquePasses returns true only when every dimension >= 8", () => {
  assert.equal(
    critiquePasses({
      scores: {
        voice_match: 8,
        stands_alone: 9,
        story_completeness: 10,
        argument_clarity: 8,
      },
    }),
    true,
  );
  assert.equal(
    critiquePasses({
      scores: {
        voice_match: 7,
        stands_alone: 9,
        story_completeness: 10,
        argument_clarity: 8,
      },
    }),
    false,
  );
  assert.equal(critiquePasses(null), false);
  assert.equal(critiquePasses({}), false);
});

// ---- Tool surface ---------------------------------------------------------

test("NEWSLETTER_EDITOR_TOOLS exposes edit_for_newsletter with required schema", () => {
  assert.equal(NEWSLETTER_EDITOR_TOOLS.length, 1);
  const tool = NEWSLETTER_EDITOR_TOOLS[0];
  assert.equal(tool.name, "edit_for_newsletter");
  assert.equal(tool.input_schema.type, "object");
  assert.deepEqual(tool.input_schema.required.sort(), [
    "author_slug",
    "source",
  ]);
  assert.ok(tool.input_schema.properties.source);
  assert.ok(tool.input_schema.properties.author_slug);
  assert.ok(tool.input_schema.properties.target_word_count);
  assert.ok(tool.input_schema.properties.format);
});

// ---- Behavior: unknown author --------------------------------------------

test("unknown author returns a clear error, not a crash", async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key-not-called";
  try {
    const result = await executeNewsletterEditorTool(
      "edit_for_newsletter",
      {
        author_slug: "definitely-not-a-real-author-xyz",
        source: "some raw notes",
      },
      {},
    );
    assert.ok(result.error, "expected an error for unknown author");
    assert.match(result.error, /no voice card found/);
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  }
});

// ---- Behavior: max-revisions termination ---------------------------------

test("critique loop terminates at MAX_REVISIONS with all failing scores", async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key-stubbed";
  try {
    let draftCalls = 0;
    let critiqueCalls = 0;
    const callClaudeText = async () => {
      draftCalls += 1;
      return { text: `draft v${draftCalls}` };
    };
    const callClaudeJson = async () => {
      critiqueCalls += 1;
      return {
        scores: {
          voice_match: 4,
          stands_alone: 4,
          story_completeness: 4,
          argument_clarity: 4,
        },
        line_level_fixes: [
          { before: "x", after: "y", reason: "rule 1: voice off" },
        ],
        what_to_cut: ["the half-told Juan story"],
      };
    };

    const result = await executeNewsletterEditorTool(
      "edit_for_newsletter",
      {
        author_slug: "sagar-tiwari",
        source: "some raw notes that won't pass critique",
      },
      { callClaudeText, callClaudeJson },
    );

    assert.equal(result.passes, false, "should not pass with all 4s");
    assert.equal(
      result.critique_log.length,
      MAX_REVISIONS + 1,
      `critique_log should have ${MAX_REVISIONS + 1} entries`,
    );
    assert.equal(
      draftCalls,
      MAX_REVISIONS + 1,
      `should call draft once + ${MAX_REVISIONS} revisions`,
    );
    assert.equal(critiqueCalls, MAX_REVISIONS + 1);
    assert.ok(result.note, "should explain why it gave up");
    assert.match(result.note, /best of/);
    assert.equal(result.final_draft, `draft v${MAX_REVISIONS + 1}`);
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  }
});

// ---- Behavior: passes on first critique ----------------------------------

test("critique loop exits early when first draft passes", async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key-stubbed";
  try {
    let draftCalls = 0;
    let critiqueCalls = 0;
    const callClaudeText = async () => {
      draftCalls += 1;
      return { text: "a perfectly written draft" };
    };
    const callClaudeJson = async () => {
      critiqueCalls += 1;
      return {
        scores: {
          voice_match: 9,
          stands_alone: 9,
          story_completeness: 10,
          argument_clarity: 9,
        },
        line_level_fixes: [],
        what_to_cut: [],
      };
    };

    const result = await executeNewsletterEditorTool(
      "edit_for_newsletter",
      { author_slug: "sagar-tiwari", source: "clean source" },
      { callClaudeText, callClaudeJson },
    );

    assert.equal(result.passes, true);
    assert.equal(draftCalls, 1, "should only call draft once");
    assert.equal(critiqueCalls, 1, "should only critique once");
    assert.equal(result.critique_log.length, 1);
    assert.equal(result.final_draft, "a perfectly written draft");
    assert.equal(result.author_slug, "sagar-tiwari");
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  }
});

// ---- Behavior: validation -------------------------------------------------

test("missing source returns a validation error", async () => {
  const result = await executeNewsletterEditorTool(
    "edit_for_newsletter",
    { author_slug: "sagar-tiwari" },
    {},
  );
  assert.match(result.error, /source is required/);
});

test("missing author_slug returns a validation error", async () => {
  const result = await executeNewsletterEditorTool(
    "edit_for_newsletter",
    { source: "some text" },
    {},
  );
  assert.match(result.error, /author_slug is required/);
});

// ---- Revision prompt template --------------------------------------------

test("REVISION_PROMPT_TEMPLATE includes prior draft, critique JSON, and voice card", () => {
  const prompt = REVISION_PROMPT_TEMPLATE({
    draft: "OLD DRAFT TEXT",
    critiqueJson: {
      scores: { voice_match: 5, stands_alone: 4 },
      line_level_fixes: [],
    },
    voiceCard: "VOICE_CARD_BLOCK",
  });
  assert.ok(prompt.includes("OLD DRAFT TEXT"));
  assert.ok(prompt.includes("VOICE_CARD_BLOCK"));
  assert.ok(prompt.includes("voice_match"));
  assert.ok(prompt.includes("1. Write from the author's perspective"));
});
