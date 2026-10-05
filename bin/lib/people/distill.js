// @ts-nocheck
// people distill: durable facts pulled from new messages in batches, and
// bridge-facts, which turns those quick facts into scored observations.

"use strict";

const { c, say, parseArgs } = require("./output");
const { db, uuid, nowISO, syncState } = require("./db");
const { cmdScore } = require("./scoring");
const { claudeJSON } = require("./model");

// ---------------------------------------------------------------- distill
// The 543 facts in this store were extracted by a human reading 500k messages
// once. That does not survive contact with next semester. `distill` is the
// repeatable version: it hands new messages to Claude in batches, gets back
// durable facts, and moves a watermark so it never re-reads the same message.

const DISTILL_SLOTS = [
  "who_they_are", "family", "works_on", "school", "how_we_met", "history",
  "ask_about", "cares_about", "music", "interests", "food", "health",
  "faith", "how_they_think", "advice_they_gave", "can_introduce",
];

// Facts about someone else's mental health, crises, or relationships are not
// ours to file. Caleb ruled on this directly: do not extract them.
const DISTILL_FORBIDDEN =
  /\b(suicid|kill (my|him|her|them)self|self.?harm|overdose|psych ward|inpatient|rehab|relapse|eating disorder|anorexi|bulimi|abus(e|ed|ive)|assault|rape|molest|miscarriage|abortion|divorce|custody|antidepressant|lexapro|prozac|zoloft|adderall|bipolar|manic episode)/i;

function distillPrompt(name, lines) {
  return [
    "Extract durable facts about this person from their own messages.",
    "",
    "A durable fact is one you would still want to know in a year: what they do,",
    "where they are from, who is in their family, what they are into, what they",
    "are working on, advice they gave, something they care about. Logistics are",
    "not facts. \"running late\", \"on my way\", \"I have class at 3\" are all noise.",
    "",
    "Rules:",
    "- Only facts stated by this person about themselves.",
    "- Do NOT extract anything about their mental health, a crisis, addiction,",
    "  abuse, or the breakdown of a relationship. Skip those messages entirely.",
    "- Prefer few excellent facts over many weak ones. Zero is a valid answer.",
    "- Keep the person's own words in `quote`, verbatim and short.",
    "- `slot` must be one of: " + DISTILL_SLOTS.join(", "),
    "",
    "Output ONLY a JSON array, no prose:",
    '[{"slot":"...","value":"one sentence, third person","quote":"their words","at":"YYYY-MM-DD"}]',
    "",
    `Person: ${name}`,
    "Messages:",
    ...lines,
  ].join("\n");
}

const DISTILL_SYSTEM =
  "You extract durable facts about people from their own text messages. " +
  "You reply with a JSON array and nothing else: no preamble, no prayer, no explanation.";

async function distillCall(prompt, model) {
  const out = await claudeJSON(prompt, DISTILL_SYSTEM, model);
  if (!out) return { error: "no response" };
  const a = out.indexOf("[");
  const b = out.lastIndexOf("]");
  if (a < 0 || b <= a) return { facts: [] };
  try {
    return { facts: JSON.parse(out.slice(a, b + 1)) };
  } catch {
    return { error: "unparseable JSON" };
  }
}

async function cmdDistill(argv) {
  const { flags } = parseArgs(argv);
  const d = db();
  const model = flags.model || "claude-sonnet-5";
  const perPerson = Number(flags.max) || 120;
  const minMsgs = Number(flags.min) || 4;
  const dry = !!flags["dry-run"];

  const since = flags.all
    ? ""
    : flags.since ||
      (d.prepare("SELECT value FROM sync_state WHERE key='distill_watermark'").get() || {}).value ||
      "";

  const rows = d
    .prepare(
      `SELECT m.person_id, p.name, m.body, m.sent_at
         FROM messages m JOIN people p ON p.id = m.person_id
        WHERE m.from_me = 0 AND p.deleted_at IS NULL AND p.muted_at IS NULL
          AND m.body IS NOT NULL AND length(m.body) BETWEEN 20 AND 500
          AND m.sent_at > ?
          AND (p.distilled_at IS NULL OR m.sent_at > p.distilled_at)
        ORDER BY m.person_id, m.sent_at`,
    )
    .all(since);

  if (!rows.length) return say(c.dim("  nothing new to distill"));

  const byPerson = new Map();
  let newest = since;
  for (const r of rows) {
    if (r.sent_at > newest) newest = r.sent_at;
    if (DISTILL_FORBIDDEN.test(r.body)) continue;
    if (!byPerson.has(r.person_id)) byPerson.set(r.person_id, { name: r.name, lines: [] });
    byPerson.get(r.person_id).lines.push(`${String(r.sent_at).slice(0, 10)} ${r.body.replace(/\s+/g, " ")}`);
  }

  // IMPORTANT PEOPLE FIRST, because this run will be interrupted.
  //
  // A full pass is 1,236 model calls over 132,000 messages, and something will
  // stop it: a rate limit, a closed laptop, a change of mind. Arbitrary order
  // means a run that dies at 40% has read a random 40%, and the per-person
  // watermark then records that as done. Ordering by how much the relationship
  // scores, and by how much was actually said, means the half that completes is
  // the half worth having, and the tail that never runs is people with twenty
  // messages from 2019.
  const rank = new Map(
    d
      .prepare(
        `SELECT p.id, COALESCE(s.base_score,0) AS score, COALESCE(s.observation_count,0) AS obs
           FROM people p LEFT JOIN person_scores s ON s.person_id = p.id`,
      )
      .all()
      .map((r) => [r.id, r.score]),
  );
  const ordered = [...byPerson.entries()].sort((a, b) => {
    const sa = rank.get(a[0]) || 0, sb = rank.get(b[0]) || 0;
    if (sb !== sa) return sb - sa;
    return b[1].lines.length - a[1].lines.length;
  });
  byPerson.clear();
  for (const [k, v] of ordered) byPerson.set(k, v);

  // Someone who sent three logistics texts has nothing to distill. Spending a
  // model call on them is the main way this gets expensive for no reason.
  const queue = [...byPerson.entries()].filter(([, v]) => v.lines.length >= minMsgs);
  queue.sort((a, b) => b[1].lines.length - a[1].lines.length);
  const cap = Number(flags.limit) || queue.length;
  const work = queue.slice(0, cap);

  say("");
  say(`${c.b("distill")} ${work.length} people${c.dim(`  ${since ? "since " + since.slice(0, 10) : "all time"}  model ${model}`)}`);
  if (dry) {
    for (const [, v] of work.slice(0, 20)) say(c.dim(`  ${String(v.lines.length).padStart(5)}  ${v.name}`));
    return say(c.dim(`\n  dry run, nothing written`));
  }

  const up = d.prepare(
    `INSERT INTO quick_facts (person_id, key, value, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(person_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  );
  let wrote = 0, failed = 0, done = 0;

  // Most of each call is Claude Code booting rather than thinking, so this
  // parallelises almost perfectly. Serial, a full history is a twelve hour job.
  const width = Math.max(1, Math.min(Number(flags.concurrency) || 8, 16));
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= work.length) return;
      const [pid, v] = work[i];
      const lines =
        v.lines.length > perPerson
          ? v.lines.filter((_, j) => j % Math.ceil(v.lines.length / perPerson) === 0)
          : v.lines;
      const { facts, error } = await distillCall(distillPrompt(v.name, lines), model);
      done++;
      if (error) {
        failed++;
      } else {
        for (const f of facts || []) {
          const slot = String(f.slot || "").trim();
          const val = String(f.value || "").trim();
          if (!slot || !val || !DISTILL_SLOTS.includes(slot)) continue;
          if (DISTILL_FORBIDDEN.test(val) || DISTILL_FORBIDDEN.test(String(f.quote || ""))) continue;
          const line = val + (f.quote ? `  - ${f.at || ""}: "${String(f.quote).trim()}"` : "");
          const prev = d.prepare("SELECT value FROM quick_facts WHERE person_id=? AND key=?").get(pid, slot);
          const merged = prev && !prev.value.includes(val) ? prev.value + "\n" + line : prev ? prev.value : line;
          up.run(pid, slot, merged, nowISO());
          wrote++;
        }
      }
      if (!error)
        d.prepare("UPDATE people SET distilled_at=? WHERE id=?").run(nowISO(), pid);
      if (done % 25 === 0) say(c.dim(`  ${done}/${work.length}  ${wrote} facts`));
    }
  };
  await Promise.all(Array.from({ length: width }, worker));

  // Only advance the watermark on a full pass. A --limit run would otherwise
  // skip everyone it did not get to.
  if (!flags.limit && newest) syncState("distill_watermark", newest);
  say(`${c.grn("distilled")} ${wrote} facts from ${work.length} people${failed ? c.dim(`  (${failed} failed)`) : ""}`);

  // FINISH THE JOB. A distilled fact that never reaches a dimension is a
  // display string, and the score it should have moved stays at zero. Nobody
  // installing this would know to run two more commands afterwards, and the
  // symptom of not running them is a well-documented person reading as cold.
  if (wrote) {
    try {
      cmdBridgeFacts([]);
      cmdScore();
    } catch (e) {
      say(c.yel(`  facts written, but scoring them failed: ${e.message}`));
      say(c.dim(`  run: people bridge-facts && people score`));
    }
  }
}

// Distilled facts are evidence, and the scorer could not see them.
//
// `people distill` writes what it learns into quick_facts. Scoring reads
// observations. Nothing joined the two, so the best-documented people in the
// store scored 0.00 across all six dimensions and printed "nothing recorded in
// any dimension yet" directly underneath four paragraphs about them. Cole Garner
// has a career, how he thinks and who he is on file, and ranked as cold.
//
// The fact keys already name their dimension; they just never said so in a
// column. This maps them and writes one observation per fact, marked
// `inferred` because a distilled fact is read out of a conversation rather than
// stated to the user directly.
const FACT_DIMENSION = {
  faith: "spiritual",
  family: "social",
  friends: "social",
  who_they_are: "social",
  how_we_met: "social",
  health: "physical",
  fitness: "physical",
  food: "physical",
  music: "emotional",
  interests: "emotional",
  cares_about: "emotional",
  ask_about: "emotional",
  works_on: "intellectual",
  career: "intellectual",
  school: "intellectual",
  how_they_think: "intellectual",
  advice_they_gave: "intellectual",
  history: "intellectual",
  money: "financial",
  financial: "financial",
  sports: "physical",
  birthday: "social",
  can_introduce: "social",
  how_to_help: "social",
  how_to_work_with_them: "intellectual",
};

// THE DISTILLER INVENTS GENDERED KEYS. `who_he_is`, `who_she_is`,
// `advice_he_gave`, `how_he_thinks`, `how_to_work_with_him` are the same facts
// as their neutral forms with a pronoun baked into the column name, and 194 of
// them fell through the mapping unscored for that reason alone. Normalising the
// key is also the right thing regardless: a schema should not carry somebody's
// pronoun in a field name.
function normalizeFactKey(k) {
  return String(k || "")
    .toLowerCase()
    .replace(/_(he|she|him|her|his|hers|they|them|their)_/g, "_they_")
    .replace(/_(he|she|him|her|his|hers)$/g, "_them")
    .replace(/^(who|how_to_work_with|advice|how)_(he|she)_/, "$1_they_")
    .replace(/who_(he|she)_is/, "who_they_are")
    .replace(/advice_(he|she)_gave/, "advice_they_gave")
    .replace(/how_(he|she)_thinks/, "how_they_think")
    .replace(/how_to_work_with_(him|her)/, "how_to_work_with_them");
}

function cmdBridgeFacts(argv) {
  const { flags } = parseArgs(argv);
  const apply = !flags["dry-run"];
  const d = db();
  const dims = new Map(
    d.prepare(`SELECT id, code FROM dimensions`).all().map((r) => [r.code, r.id]),
  );
  const rows = d
    .prepare(
      `SELECT q.person_id, q.key, q.value FROM quick_facts q
        WHERE q.key NOT IN ('first_move')
          AND NOT EXISTS (
            SELECT 1 FROM observations o
             WHERE o.person_id = q.person_id AND o.deleted_at IS NULL
               AND o.body = q.value)`,
    )
    .all();

  let made = 0, skipped = 0;
  for (const r of rows) {
    const dim = FACT_DIMENSION[normalizeFactKey(r.key)] || FACT_DIMENSION[r.key];
    if (!dim || !dims.has(dim)) { skipped++; continue; }
    if (apply) {
      const id = uuid();
      d.prepare(
        `INSERT INTO observations (id, person_id, kind, modality, source, body, observed_at)
         VALUES (?,?,'fact','actual','inferred',?, datetime('now'))`,
      ).run(id, r.person_id, r.value);
      d.prepare(
        `INSERT OR IGNORE INTO observation_dimensions (observation_id, dimension_id, weight)
         VALUES (?,?,1.0)`,
      ).run(id, dims.get(dim));
    }
    made++;
  }
  say();
  say(`  ${c.b(String(made))} distilled fact(s) ${apply ? "now count" : "would count"} toward a dimension.`);
  if (skipped) say(c.dim(`  ${skipped} had no dimension mapping and were left alone.`));
  if (apply) say(c.dim(`  Run: people score`));
  say();
}

module.exports = {
  cmdDistill, cmdBridgeFacts,
};
