// @ts-nocheck
// people events: finding the days in the message history worth reading,
// asking the model what happened on them, and writing the answers as
// observations (events scan, list, reset, auto).

"use strict";

const { c, say, parseArgs } = require("./output");
const { db, nowISO, syncState } = require("./db");
const { findPerson } = require("./lookup");
const { recomputeScores } = require("./scoring");
const { claudeJSON, pool } = require("./model");
const { insertObservation } = require("./observations");

// ------------------------------------------------------------------ events
//
// The lexicon is the cheap first pass: it decides which DAYS are worth reading,
// not what happened on them. Precision does not matter here and recall does,
// because a day this misses is a day the model never sees. Judging what
// actually happened is the model's job, further down.
const EVENT_LEXICON = [
  // meals and drinks
  "in n out", "in-n-out", "innout", "lunch", "dinner", "breakfast", "brunch",
  "coffee", "boba", "chipotle", "ramen", "sushi", "pizza", "tacos", "burger",
  "grab food", "grab a bite", "grab dinner", "grab lunch", "ate at", "eating at",
  "dining hall", "parkside", "cava", "shake shack", "raising cane", "panda express",
  // going somewhere together
  "hang out", "hung out", "pull up", "pulled up", "came over", "come over",
  "picked up", "pick you up", "dropped off", "drove to", "went to", "going to",
  "on my way", "see you at", "meet at", "meeting at", "grabbed",
  // named occasions
  "birthday", "party", "concert", "movie", "game", "beach", "hike", "hiking",
  "gym", "workout", "church", "bible study", "worship night", "retreat",
  "formal", "banquet", "wedding", "funeral", "graduation", "interview",
  // travel
  "flight", "flying", "landed", "airport", "road trip", "driving up", "driving down",
  // milestones worth remembering
  "got the job", "got in", "accepted", "rejected", "committed to", "signed",
  "moved in", "moved out", "quit", "started at", "launched", "shipped",
];

/// The lexicon as ONE full-text query rather than sixty LIKE clauses.
///
/// `lower(body) LIKE '%lunch%'` cannot use an index, so sixty of them against
/// half a million messages is sixty full scans, and the first attempt at this
/// sat grinding for minutes without ever reaching the model. The same lexicon
/// against the FTS index that already exists returns in about five
/// milliseconds.
///
/// Prefix terms carry the inflections a LIKE got for free: FTS matches whole
/// tokens, so `hike` alone would miss "hiking". Multi-word entries become
/// phrases, and FTS drops punctuation, which makes "in-n-out" and "in n out"
/// the same query.
function eventMatchQuery() {
  const seen = new Set();
  const parts = [];
  for (const term of EVENT_LEXICON) {
    const clean = term.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    if (clean.includes(" ")) parts.push(`"${clean}"`);
    else parts.push(clean.length >= 4 ? `${clean}*` : clean);
  }
  return parts.join(" OR ");
}

/// Everything said with one person on one day, so the model can see that "6pm?"
/// was answered with "otw". A day judged from a single matching line is a day
/// judged without the reply that settles it.
function episodeTranscript(d, personId, day, cap = 40) {
  const rows = d
    .prepare(
      `SELECT from_me, body, sent_at FROM messages
        WHERE person_id = ? AND substr(sent_at,1,10) = ?
        ORDER BY sent_at LIMIT ?`,
    )
    .all(personId, day, cap);
  return rows
    .map((r) => `${r.sent_at.slice(11, 16)} ${r.from_me ? "ME" : "THEM"}: ${r.body.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");
}

const EVENT_SYSTEM = `You extract events from one day of text messages between the user and one other person.

An EVENT is something that occupies time and place: a meal, a hangout, a drive, a workout, a service, a party, a trip, an interview, a milestone. Not a topic, not a feeling, not a link someone sent.

For each event, decide MODALITY, which matters more than anything else here:
- "actual": it happened, or is happening as they type. Past tense, or present tense narration ("grabbing in n out now"), or a later message that only makes sense if it happened ("that was fire", "sorry I was late").
- "planned": agreed for a future time and not yet confirmed to have occurred.
- "declined": proposed and refused, cancelled, or fell through.
Drop anything you would have to guess about. A day with no clear event returns an empty array. Most days have none, and that is the correct answer.

Return ONLY a JSON array, no prose, no code fence:
[{"body":"got In-N-Out together","modality":"actual","kind":"experience","others":["Nina","Jacob"]}]

Rules for "body": one short past-tense clause, under 12 words, naming the specific thing. "got In-N-Out in Alhambra" not "had a meal". Do not name the other person in the body; the store already knows whose record this is.
"others": people named in the text who were also there. Omit if none. Never invent a name.
"kind": "experience" for something they did, "fact" for a durable milestone (got the job, moved in).

ONE ENTRY PER DISTINCT EVENT. Never return the same event twice in different words. "went to a game" and "went to the USC football game" are one event, not two, and so are "met at Starbucks for a medication swap" and "met at Starbucks to exchange meds". If you are about to write a second line about a thing you already wrote, write the more specific version and drop the other.`;


// A day yields one event per thing that happened, and the model does not always
// agree. Measured on 2026-09-07: a 16-day scan wrote "went to football game" and
// "attended game at USC" as two rows, and did the same for four other days. The
// prompt now forbids it and this catches what still gets through, including on a
// rescan, where the earlier run's rows are already in the table.
// Grammar words plus the generic event verbs, which carry no identity. Without
// them "submitted Stanford application" and "submitted Penn application" agree
// on two tokens and collapse into one, losing a real event. Measured against
// his actual history on 2026-09-07, which is where that pair came from.
const EVENT_STOP = new Set(["a","an","the","to","at","in","on","for","of","with",
  "and","or","we","i","he","she","they","it","his","her","their","my","our","was",
  "were","had","has","have","did","up","out","some","that","this","from","by",
  "went","got","get","going","attended","attend","submitted","submit","played",
  "play","watched","watch","visited","visit","dropped","drop","picked","pick",
  "took","take","made","make","held","hold","hung","hang","ate","eat","drove",
  "drive","did","done","together","group","friends",
  // "met with Mr. Silver" and "met with Mr. Irie" are two different meetings on
  // one day, and they agreed on "met" and "mr" until these were added.
  "met","meet","meeting","mr","mrs","ms","dr"]);

function eventTokens(body) {
  return new Set(
    // Possessives matter: "John's house" and "JJ's house" both leave a bare "s"
    // once punctuation goes, and that stray token was enough to merge two
    // different houses on one day. Anything under two characters is dropped.
    String(body || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
      .filter((w) => w.length > 1 && !EVENT_STOP.has(w)),
  );
}

function sameEvent(a, b) {
  const A = eventTokens(a), B = eventTokens(b);
  if (!A.size || !B.size) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  // Subset means one phrasing is strictly the vaguer version of the other:
  // "went to Santa Monica" inside "went to Santa Monica beach". Requires at
  // least two distinctive words on the smaller side, because a one-word body
  // is a subset of everything that happens to mention it: "attended church"
  // sits inside "pre-church workout", and those are two different events on
  // the same morning. Both examples are from his real history.
  if (Math.min(A.size, B.size) >= 2 && (shared === A.size || shared === B.size)) return true;
  // Half the distinctive words in common. Deliberately conservative: this runs
  // against a person's real history, and merging two events that only rhyme
  // deletes something that happened. Under-merging leaves a visible duplicate,
  // which is annoying; over-merging is silent and permanent.
  //
  // Known limit, accepted: a pure synonym restatement that shares no
  // distinctive word ("football game" / "game at USC") still writes twice. The
  // prompt is the defence against that, not this function.
  // 0.55 rather than 0.5 on purpose: at 0.5 exactly, "lunch with church
  // friends" and "went to church" collapse, and those are two things that
  // happened on one Sunday.
  return shared / (A.size + B.size - shared) >= 0.55;
}

async function classifyEpisodes(batch, model) {
  const payload = batch
    .map(
      (e, i) =>
        `### EPISODE ${i}\nPERSON: ${e.name}\nDATE: ${e.day}\n${e.transcript}`,
    )
    .join("\n\n");
  const prompt =
    `${payload}\n\nReturn a JSON array of arrays: one array of events per episode, in order, ${batch.length} entries total. Empty array for an episode with no event.`;

  const out = await claudeJSON(prompt, EVENT_SYSTEM, model);
  if (!out) return batch.map(() => []);
  let parsed;
  try {
    const m = out.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(m ? m[0] : out);
  } catch {
    return batch.map(() => []);
  }
  if (!Array.isArray(parsed)) return batch.map(() => []);
  return batch.map((_, i) => (Array.isArray(parsed[i]) ? parsed[i] : []));
}

/// The model is told not to name the person whose record this is, and it does
/// it anyway often enough that the rule cannot be the only defence. "met Sam
/// at village" reads wrong on Sam's own row, so strip his name out of it
/// here where the answer is certain rather than asking again more firmly.
function stripOwnerName(body, fullName) {
  const parts = String(fullName)
    .split(/\s+/)
    .filter((w) => w.length > 2 && /^[A-Za-z][a-z]+$/.test(w));
  if (!parts.length) return body;
  let out = body;
  for (const name of parts) {
    const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // "with Sam and Nina" -> "with Nina";  "with Sam" -> ""
    out = out.replace(new RegExp(`\\bwith ${n} and\\b`, "gi"), "with");
    out = out.replace(new RegExp(`\\band ${n}\\b`, "gi"), "");
    out = out.replace(new RegExp(`\\bwith ${n}\\b`, "gi"), "");
    out = out.replace(new RegExp(`\\b${n}'s\\b`, "gi"), "their");
    out = out.replace(new RegExp(`\\b${n}\\b`, "gi"), "");
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/^[\s,]+|[\s,]+$/g, "").trim();
}

/// Contacts are saved as "Sam Rivera GOAT", and the model writes "Sam", so
/// an exact match resolves nobody. Match on a whole word inside the stored
/// name, and only accept an unambiguous hit: two people called Chris is a
/// reason to record neither, not to guess.
function resolveOtherPerson(d, needle) {
  const n = String(needle).trim();
  if (n.length < 2) return null;
  const exact = d
    .prepare("SELECT id FROM people WHERE deleted_at IS NULL AND lower(name) = lower(?)")
    .all(n);
  if (exact.length === 1) return exact[0].id;
  const hits = d
    .prepare(
      `SELECT id, name FROM people WHERE deleted_at IS NULL
        AND (lower(name) LIKE lower(?) OR lower(name) LIKE lower(?))`,
    )
    .all(n + " %", "% " + n + " %");
  return hits.length === 1 ? hits[0].id : null;
}

function NSLOGGED_ERR(e) {
  process.stderr.write(`  batch failed: ${(e && e.message) || e}\n`);
}

/// The hook path. Runs a small, throttled slice of the scan so that events keep
/// up with the messages on their own, without anyone remembering to do it.
///
/// Three things keep this from being a nuisance. It is THROTTLED, so a day of
/// twenty sessions costs one scan, not twenty. It is BOUNDED, so a single run
/// is a handful of model calls rather than an open-ended bill. And it is SILENT
/// unless something was found, because a hook that talks during unrelated work
/// is a hook people turn off.
async function eventsAuto(flags) {
  const everyHours = Number(flags.every || 6);
  const last = syncState("events_last_auto");
  if (last && (Date.now() - Date.parse(last.replace(" ", "T"))) < everyHours * 3600000) {
    return;
  }
  syncState("events_last_auto", nowISO());
  await cmdEvents([
    "scan",
    "--days", String(flags.days || 21),
    "--limit", String(flags.limit || 60),
    "--batch", String(flags.batch || 10),
    "--concurrency", String(flags.concurrency || 3),
    "--quiet",
  ]);
}

async function cmdEvents(argv) {
  const sub = ["scan", "list", "reset", "auto"].includes(argv[0]) ? argv.shift() : "list";
  if (sub === "auto") return eventsAuto(parseArgs(argv).flags);
  const { flags, rest } = parseArgs(argv);
  const d = db();

  if (sub === "list") {
    const who = rest.join(" ");
    const person = who ? findPerson(who) : null;
    const rows = d
      .prepare(
        `SELECT o.observed_at, o.body, o.modality, p.name
           FROM observations o JOIN people p ON p.id = o.person_id
          WHERE o.kind IN ('experience','fact') AND o.source = 'imported'
            AND o.deleted_at IS NULL ${person ? "AND o.person_id = ?" : ""}
          ORDER BY o.observed_at DESC LIMIT ?`,
      )
      .all(...(person ? [person.id] : []), Number(flags.limit || 40));
    if (!rows.length) return say(c.dim("\n  no events logged yet. run: people events scan\n"));
    say("");
    for (const r of rows) {
      const tag = r.modality === "actual" ? "" : c.dim(` (${r.modality})`);
      say(`  ${c.dim(r.observed_at.slice(0, 10))}  ${r.name.slice(0, 20).padEnd(21)} ${r.body}${tag}`);
    }
    say("");
    return;
  }

  if (sub === "reset") {
    const n = d.prepare("DELETE FROM event_scan_state").run().changes;
    return say(c.dim(`\n  cleared ${n} scanned days. events already written are kept.\n`));
  }

  // scan
  const since = flags.since || (flags.days ? new Date(Date.now() - Number(flags.days) * 86400000).toISOString().slice(0, 10) : "2000-01-01");
  const model = flags.model || "haiku";
  const batchSize = Math.max(1, Math.min(30, Number(flags.batch || 12)));
  const maxEpisodes = Number(flags.limit || 400);

  const episodes = d
    .prepare(
      `SELECT m.person_id, p.name, substr(m.sent_at,1,10) AS day, COUNT(*) AS hits
         FROM messages_fts f
         JOIN messages m ON m.msg_id = f.rowid
         JOIN people p ON p.id = m.person_id
        WHERE f.messages_fts MATCH ?
          AND m.person_id IS NOT NULL
          AND substr(m.sent_at,1,10) >= ?
          AND NOT EXISTS (SELECT 1 FROM event_scan_state s
                           WHERE s.person_id = m.person_id AND s.day = substr(m.sent_at,1,10))
        GROUP BY m.person_id, day
        ORDER BY day DESC
        LIMIT ?`,
    )
    .all(eventMatchQuery(), since, maxEpisodes);

  if (!episodes.length) {
    if (flags.quiet) return;
    return say(c.dim("\n  nothing new to read. `people events reset` to rescan from scratch.\n"));
  }

  const quiet = !!flags.quiet;
  const note = (t) => { if (!quiet) say(t); };
  note(c.dim(`\n  reading ${episodes.length} person-days with ${model}...`));
  const markScanned = d.prepare(
    "INSERT INTO event_scan_state (person_id, day, found) VALUES (?,?,?) ON CONFLICT DO NOTHING",
  );

  const batches = [];
  for (let i = 0; i < episodes.length; i += batchSize) {
    batches.push(
      episodes.slice(i, i + batchSize).map((e) => ({
        ...e,
        transcript: episodeTranscript(d, e.person_id, e.day),
      })),
    );
  }
  const conc = Math.max(1, Math.min(8, Number(flags.concurrency || 4)));
  note(c.dim(`  ${batches.length} batches, ${conc} at a time`));

  let written = 0, read = 0, dupes = 0;

  // Persist each batch AS IT LANDS. Collecting all of them first and writing
  // at the end means a run interrupted at batch 600 of 666 saved nothing, and
  // these runs are long enough that being interrupted is the normal case.
  // What is already on this person's day, so a rescan or a repeated model answer
  // does not write the same event twice.
  const bodiesOnDay = d.prepare(
    `SELECT body FROM observations
      WHERE person_id = ? AND substr(observed_at,1,10) = ? AND deleted_at IS NULL`,
  );

  const commitBatch = (batch, results) => {
    for (let j = 0; j < batch.length; j++) {
      const ep = batch[j];
      const events = results[j] || [];
      read++;
      markScanned.run(ep.person_id, ep.day, events.length);
      const seen = bodiesOnDay.all(ep.person_id, ep.day).map((r) => r.body);
      for (const ev of events) {
        if (!ev || typeof ev.body !== "string" || !ev.body.trim()) continue;
        const modality = ["actual", "planned", "declined"].includes(ev.modality) ? ev.modality : "actual";
        // Only things that actually happened become part of the record. A
        // plan that was never confirmed is noise on a timeline of a life.
        if (flags["only-actual"] !== false && modality !== "actual") continue;
        const at = `${ep.day} 12:00:00`;
        const body = stripOwnerName(ev.body.trim(), ep.name);
        if (body.length < 4) continue;
        if (seen.some((prev) => sameEvent(prev, body))) { dupes++; continue; }
        seen.push(body);
        insertObservation({
          personId: ep.person_id,
          body,
          flags: { kind: ev.kind === "fact" ? "fact" : "experience", modality,
                   source: "imported", at, dimFallback: "social" },
          judge: true,
        });
        written++;
        // Someone else named as present was there too, and their record should
        // say so. Third-party rather than told_directly, because it came from
        // somebody else's message.
        for (const other of Array.isArray(ev.others) ? ev.others.slice(0, 6) : []) {
          const otherId = resolveOtherPerson(d, other);
          if (!otherId || otherId === ep.person_id) continue;
          const otherName = d.prepare("SELECT name FROM people WHERE id=?").get(otherId).name;
          const otherBody = stripOwnerName(ev.body.trim(), otherName);
          if (otherBody.length < 4) continue;
          insertObservation({
            personId: otherId,
            body: otherBody,
            flags: { kind: "experience", modality, source: "third_party", at, dimFallback: "social" },
            judge: true,
          });
          written++;
        }
      }
    }
  };

  let failed = 0;
  await pool(
    batches.map((b) => async () => {
      try {
        const results = await classifyEpisodes(b, model);
        commitBatch(b, results);
      } catch (e) {
        // One bad batch must not end a run that has hours behind it. The days
        // in it stay unmarked, so the next scan picks them up again.
        failed++;
        NSLOGGED_ERR(e);
      }
      return null;
    }),
    conc,
    (done, total) =>
      note(c.dim(`  batch ${done}/${total}  ${written} events from ${read} days`)),
  );

  recomputeScores();
  // A quiet run still speaks when it found something, because that is the one
  // thing worth knowing; silence means there was nothing new.
  if (quiet) {
    if (written) say(c.dim(`  ${written} new event(s) logged from your messages`));
    return;
  }
  say(`\n  ${c.grn("logged")} ${written} events from ${read} person-days`);
  if (dupes) say(c.dim(`  ${dupes} near-duplicate(s) of an event already on the day, skipped`));
  if (failed) say(c.dim(`  ${failed} batch(es) failed and were left unmarked; rerun to retry them`));
  say(c.dim("  people events list        to read them"));
  say(c.dim("  people history <name>     to see them on the curve\n"));
}

module.exports = {
  cmdEvents,
};
