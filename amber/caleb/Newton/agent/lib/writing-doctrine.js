/**
 * Writing doctrine resolver — Shirley's 4 rules and per-org overrides.
 *
 * The voice doctrine (AMBER_VOICE_DOCTRINE_TEMPLATE in prompts.js) covers
 * how Medha SOUNDS in conversation. This module covers how Medha
 * GHOST-WRITES on behalf of a human author (a newsletter, an essay, a
 * post). The two are orthogonal: register doctrine is conversational
 * tone; writing doctrine is editorial rules for long-form output.
 *
 * Resolution order (first non-null wins):
 *   1. tenant.onboardingProfile.writingDoctrine
 *   2. tenant.writingDoctrine                      (top-level slug)
 *   3. tenant.org default                          (from tenant.org)
 *   4. null                                        (no doctrine)
 *
 * Allowed slugs (case-insensitive): "bma", "rytual".
 *
 * The block is injected ONLY when the inbound text looks like a
 * writing task (isWritingTask). iMessage chitchat does not trigger it,
 * so we do not pin Sagar's BMA voice over a "how are you" reply.
 */

import {
  BMA_WRITING_DOCTRINE,
  BMA_AUTHOR_NOTES_SAGAR,
} from "./writing-doctrines/bma.js";
import {
  RYTUAL_WRITING_DOCTRINE,
  RYTUAL_AUTHOR_NOTES,
} from "./writing-doctrines/rytual.js";

const DOCTRINES = {
  bma: { rules: BMA_WRITING_DOCTRINE, authorNotes: BMA_AUTHOR_NOTES_SAGAR },
  rytual: { rules: RYTUAL_WRITING_DOCTRINE, authorNotes: RYTUAL_AUTHOR_NOTES },
};

/**
 * Mirrors the skills/tools-writing.md trigger regex. Kept inline so this
 * module has no runtime dependency on the skills loader (skills/*.md is
 * filesystem-loaded at startup and can be empty under test).
 *
 * Casual chat keywords like "hey", "thanks", "how are you" do NOT match.
 */
const WRITING_TASK_REGEX =
  /\b(write|essay|cover letter|resume|memo|hook|intro|tone|rebuttal|objection|cold email|newsletter|blog|article|script|podcast|content calendar|draft|edit|polish|long.form|ghost.write|piece|hypothesis|stories we|talking in tables)\b/i;

export function isWritingTask(text) {
  if (typeof text !== "string" || !text.trim()) return false;
  return WRITING_TASK_REGEX.test(text);
}

function normalizeSlug(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  return Object.prototype.hasOwnProperty.call(DOCTRINES, v) ? v : null;
}

/**
 * Resolve which doctrine applies to a tenant. Returns "bma" | "rytual" | null.
 * Order: onboardingProfile.writingDoctrine -> tenant.writingDoctrine ->
 * tenant.org default -> null.
 */
export function getWritingDoctrineSlug(tenant) {
  if (!tenant) return null;
  const profile = tenant.onboardingProfile || {};
  const fromProfile = normalizeSlug(profile.writingDoctrine);
  if (fromProfile) return fromProfile;

  const fromTenant = normalizeSlug(tenant.writingDoctrine);
  if (fromTenant) return fromTenant;

  const fromOrg = normalizeSlug(tenant.org);
  if (fromOrg) return fromOrg;

  return null;
}

/**
 * Build the prompt fragment that injects writing doctrine for a tenant
 * when the inbound text looks like a writing task. Returns "" when no
 * doctrine applies or the text is not a writing task.
 */
export function buildWritingDoctrineBlock(tenant, text) {
  if (!isWritingTask(text)) return "";
  const slug = getWritingDoctrineSlug(tenant);
  if (!slug) return "";
  const doctrine = DOCTRINES[slug];
  if (!doctrine || !doctrine.rules) return "";

  const parts = [
    `\nWRITING DOCTRINE (${slug.toUpperCase()}): you are ghost-writing on behalf of a human author. These rules are non-negotiable on every long-form draft. They are editorial, not conversational. Apply them to the OUTPUT, not to your reply about the output.`,
    doctrine.rules,
  ];
  if (doctrine.authorNotes) {
    parts.push(doctrine.authorNotes);
  }
  parts.push(
    "If the brief is too thin to land the argument fully (rule 3), say so and ask one targeted question instead of guessing.",
  );
  return parts.join("\n\n") + "\n";
}

export const WRITING_DOCTRINE_SLUGS = Object.keys(DOCTRINES);
