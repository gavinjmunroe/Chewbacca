import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildWritingDoctrineBlock,
  getWritingDoctrineSlug,
  isWritingTask,
  WRITING_DOCTRINE_SLUGS,
} from "../writing-doctrine.js";

test("WRITING_DOCTRINE_SLUGS exposes the slot for each configured org", () => {
  assert.deepEqual([...WRITING_DOCTRINE_SLUGS].sort(), ["bma", "rytual"]);
});

test("isWritingTask: chitchat does NOT trigger", () => {
  assert.equal(isWritingTask("hey"), false);
  assert.equal(isWritingTask("thanks!"), false);
  assert.equal(isWritingTask("what's good"), false);
  assert.equal(isWritingTask("how are you"), false);
  assert.equal(isWritingTask(""), false);
  assert.equal(isWritingTask(null), false);
});

test("isWritingTask: long-form requests DO trigger", () => {
  assert.equal(isWritingTask("draft the newsletter"), true);
  assert.equal(isWritingTask("edit my essay"), true);
  assert.equal(isWritingTask("can you polish this draft"), true);
  assert.equal(isWritingTask("write a memo for the team"), true);
  assert.equal(isWritingTask("ghost-write a post for Sagar"), true);
});

test("getWritingDoctrineSlug: contact DM with no tenant resolves to null", () => {
  assert.equal(getWritingDoctrineSlug(null), null);
  assert.equal(getWritingDoctrineSlug({}), null);
});

test("getWritingDoctrineSlug: resolution order onboardingProfile > tenant > org", () => {
  assert.equal(
    getWritingDoctrineSlug({
      onboardingProfile: { writingDoctrine: "bma" },
      writingDoctrine: "rytual",
      org: "rytual",
    }),
    "bma",
  );
  assert.equal(
    getWritingDoctrineSlug({ writingDoctrine: "rytual", org: "bma" }),
    "rytual",
  );
  assert.equal(getWritingDoctrineSlug({ org: "BMA" }), "bma");
});

test("getWritingDoctrineSlug: unknown slugs are rejected (safety default)", () => {
  // Typos must not silently fall through to "bma" or any other doctrine.
  assert.equal(
    getWritingDoctrineSlug({
      onboardingProfile: { writingDoctrine: "bmma" },
    }),
    null,
  );
  assert.equal(getWritingDoctrineSlug({ writingDoctrine: "" }), null);
  assert.equal(getWritingDoctrineSlug({ writingDoctrine: 42 }), null);
  assert.equal(getWritingDoctrineSlug({ org: "togari" }), null);
});

test("buildWritingDoctrineBlock: short greeting returns empty block", () => {
  const block = buildWritingDoctrineBlock(
    { onboardingProfile: { writingDoctrine: "bma" } },
    "hey",
  );
  assert.equal(block, "");
});

test("buildWritingDoctrineBlock: writing task with BMA tenant contains all 4 rules", () => {
  const block = buildWritingDoctrineBlock(
    { onboardingProfile: { writingDoctrine: "bma" } },
    "draft the newsletter about Clay's competitive moat",
  );
  assert.match(block, /WRITING DOCTRINE \(BMA\)/);
  assert.match(block, /1\. Write from the author's perspective/);
  assert.match(block, /2\. Every piece stands alone/);
  assert.match(block, /3\. If a story can't land fully, cut it/);
  assert.match(block, /4\. The argument is clear and compelling/);
  // Voice notes for Sagar attach when BMA fires.
  assert.match(block, /SAGAR VOICE TELLS/);
  // The thin-brief escape hatch is included so Medha asks instead of guessing.
  assert.match(block, /thin to land/);
});

test("buildWritingDoctrineBlock: contact DM with no tenant returns empty", () => {
  const block = buildWritingDoctrineBlock(null, "edit my essay");
  assert.equal(block, "");
});

test("buildWritingDoctrineBlock: Rytual placeholder yields empty block until rules land", () => {
  // The slot exists but no rules are configured. Until Rytual's owner writes
  // the doctrine, Medha falls back to her default voice — not a half-empty
  // doctrine block.
  const block = buildWritingDoctrineBlock(
    { onboardingProfile: { writingDoctrine: "rytual" } },
    "draft the newsletter",
  );
  assert.equal(block, "");
});
