// Seed the approved Amber Q&A question bank into Cloud SQL (amber DB).
//
// COMMITTED, idempotent importer — safe to re-run. Upserts BY PROMPT: if a live
// (non-deleted) question with the same prompt exists it is UPDATED (followups /
// waterfall / dimension / answer_type), otherwise INSERTed. Requires the
// followups/waterfall columns (db/migrations/20260727_add_question_followups.sql).
//
// Run: railway run node scripts/seed-questions.js

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Materialize the service-account JSON to a temp file BEFORE importing anything
// that touches db/sql.js (mirrors the phase smoke scripts).
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-seed-questions.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");

const QUESTIONS = [
  {
    dimension: "emotional",
    answerType: "text",
    waterfall: "to_contacts",
    prompt:
      "After a long, people-heavy day, what actually refills you — being around someone you love, or finally being alone?",
    followups: [
      "Is that always true, or does it depend on who the people were?",
      "Who's the rare person whose company feels like being alone, in the best way?",
    ],
  },
  {
    dimension: "intellectual",
    answerType: "text",
    waterfall: "to_contacts",
    prompt:
      "On a hard call, what do you trust more in the end — what makes logical sense, or what feels right for the people involved?",
    followups: [
      "Has leaning too hard on one of those ever burned you?",
      "Who in your life decides the opposite way from you — and do you two clash or balance?",
    ],
  },
  {
    dimension: "intellectual",
    answerType: "text",
    waterfall: "to_contacts",
    prompt:
      "Walking into a new place, what grabs you first — the concrete details actually in front of you, or the vibe and what it could become?",
    followups: [
      "Do you trust that first read, or second-guess it?",
      "Who do you know that always catches the exact things you miss?",
    ],
  },
  {
    dimension: "physical",
    answerType: "text",
    waterfall: "to_contacts",
    prompt:
      "Be honest — does a wide-open, unplanned day feel like freedom, or like low-grade stress?",
    followups: [
      "Where do you think that comes from — how you grew up, or just how you're wired?",
      "Who in your life runs on the opposite setting, and what happens when your plans meet theirs?",
    ],
  },
];

async function upsertByPrompt(q) {
  const { rows } = await query(
    `SELECT id FROM questions WHERE prompt = $1 AND deleted_at IS NULL LIMIT 1`,
    [q.prompt],
  );
  if (rows[0]) {
    const id = rows[0].id;
    await query(
      `UPDATE questions
         SET followups = $2::jsonb, waterfall = $3, dimension = $4, answer_type = $5
       WHERE id = $1`,
      [id, JSON.stringify(q.followups), q.waterfall, q.dimension, q.answerType],
    );
    return { id, action: "updated" };
  }
  const ins = await query(
    `INSERT INTO questions (prompt, answer_type, dimension, followups, waterfall)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id`,
    [q.prompt, q.answerType, q.dimension, JSON.stringify(q.followups), q.waterfall],
  );
  return { id: ins.rows[0].id, action: "inserted" };
}

async function main() {
  let failed = false;
  for (const q of QUESTIONS) {
    try {
      const { id, action } = await upsertByPrompt(q);
      console.log(`✅ ${action} [${id}] (${q.waterfall}) ${q.prompt}`);
    } catch (e) {
      failed = true;
      console.log(`❌ seed failed for "${q.prompt.slice(0, 60)}…": ${e?.message || e}`);
    }
  }
  console.log(failed ? "\n❌ SEED FAILED" : "\n✅ SEED DONE");
  process.exit(failed ? 1 : 0);
}

main();
