// @ts-nocheck
// people circles: circle membership, facts a circle hands its members, and
// naming group chats with the model (circle, classify).

"use strict";

const { c, die, say, parseArgs } = require("./output");
const { db, uuid, nowISO } = require("./db");
const { findPerson, findCircle } = require("./lookup");
const { recomputeScores } = require("./scoring");
const { claudeJSON } = require("./model");
const { insertObservation } = require("./observations");
const { renderObs } = require("./show");

// ---------------------------------------------------------------- circles

function cmdCircle(argv) {
  const sub = argv.shift();
  const { flags, rest } = parseArgs(argv);
  const d = db();

  if (!sub || sub === "list") {
    const rows = d
      .prepare(
        `SELECT c.*, (SELECT count(*) FROM circle_members m WHERE m.circle_id = c.id) AS n
           FROM circles c WHERE c.deleted_at IS NULL ORDER BY c.name COLLATE NOCASE`,
      )
      .all();
    if (!rows.length) return say(c.dim('no circles. try: people circle create "Hiking"'));
    say("");
    for (const r of rows)
      say(
        `  ${c.b(r.name.padEnd(22))} ${c.dim(String(r.n) + " members")}` +
          (r.classified_kind ? c.dim(`  ${r.classified_kind}`) : "") +
          (r.classified_fact ? `\n    ${c.dim(r.classified_fact)}` : ""),
      );
    say("");
    return;
  }

  if (sub === "create") {
    const name = rest.join(" ").trim();
    if (!name) die('Name it: people circle create "Hiking" --desc "people I hike with"');
    if (d.prepare("SELECT 1 FROM circles WHERE lower(name)=lower(?) AND deleted_at IS NULL").get(name))
      die(`Circle "${name}" already exists.`);
    const id = uuid();
    d.prepare("INSERT INTO circles (id, name, description, color) VALUES (?,?,?,?)").run(
      id,
      name,
      flags.desc || null,
      flags.color || null,
    );
    if (flags.kind || flags.fact) {
      d.prepare(
        "UPDATE circles SET classified_kind=?, classified_fact=?, classified_at=? WHERE id=?",
      ).run(flags.kind || "other", flags.fact || null, nowISO(), id);
    }
    say(`${c.grn("created")} circle ${c.b(name)}`);
    if (flags.fact) syncCircleFacts(id);
    return;
  }

  if (sub === "classify") {
    const ci = findCircle(rest.shift());
    if (!flags.kind && !flags.fact)
      die(
        'Pass what Claude worked out: people circle classify "Hiking" --kind interest --fact "enjoys hiking"',
      );
    d.prepare(
      "UPDATE circles SET classified_kind=?, classified_fact=?, classified_at=? WHERE id=?",
    ).run(flags.kind || ci.classified_kind || "other", flags.fact || ci.classified_fact, nowISO(), ci.id);
    const n = syncCircleFacts(ci.id);
    say(`${c.grn("classified")} ${c.b(ci.name)}${c.dim(`  ${n} member facts reconciled`)}`);
    return;
  }

  if (sub === "add") {
    const ci = findCircle(rest.shift());
    if (!rest.length) die(`Add who? people circle add "${ci.name}" maggie declan`);
    for (const who of rest) {
      const p = findPerson(who);
      d.prepare(
        "INSERT INTO circle_members (circle_id, person_id) VALUES (?,?) ON CONFLICT DO NOTHING",
      ).run(ci.id, p.id);
      say(`  ${c.grn("+")} ${p.name}`);
    }
    const n = syncCircleFacts(ci.id);
    if (n) say(c.dim(`  ${n} member facts reconciled`));
    recomputeScores();
    return;
  }

  if (sub === "remove" || sub === "rm") {
    const ci = findCircle(rest.shift());
    for (const who of rest) {
      const p = findPerson(who);
      d.prepare("DELETE FROM circle_members WHERE circle_id=? AND person_id=?").run(ci.id, p.id);
      say(`  ${c.red("-")} ${p.name}`);
    }
    syncCircleFacts(ci.id);
    recomputeScores();
    return;
  }

  if (sub === "show") {
    const ci = findCircle(rest.join(" "));
    say("\n" + c.b(ci.name) + (ci.description ? c.dim(`  ${ci.description}`) : ""));
    if (ci.classified_fact) say(c.dim(`  ${ci.classified_kind}: ${ci.classified_fact}`));
    const mem = d
      .prepare(
        `SELECT p.name FROM circle_members m JOIN people p ON p.id = m.person_id
          WHERE m.circle_id = ? AND p.deleted_at IS NULL ORDER BY p.name`,
      )
      .all(ci.id);
    say("");
    for (const m of mem) say("  " + m.name);
    const obs = d
      .prepare(
        "SELECT * FROM observations WHERE circle_id=? AND deleted_at IS NULL ORDER BY observed_at DESC LIMIT 20",
      )
      .all(ci.id);
    if (obs.length) {
      say("\n" + c.cyn("about the circle"));
      for (const o of obs) say("  " + renderObs(o));
    }
    say("");
    return;
  }

  if (sub === "delete") {
    const ci = findCircle(rest.join(" "));
    // Order matters. The ON DELETE CASCADE in the schema only fires on a hard
    // delete, and this is a soft one, so the revoke has to be explicit and has
    // to run after deleted_at is set: syncCircleFacts reads that flag to decide
    // it is revoking rather than reconciling.
    d.prepare("UPDATE circles SET deleted_at=? WHERE id=?").run(nowISO(), ci.id);
    const revoked = d
      .prepare(
        "SELECT count(*) AS n FROM observations WHERE source_circle_id=? AND deleted_at IS NULL",
      )
      .get(ci.id).n;
    syncCircleFacts(ci.id);
    say(
      `${c.red("deleted")} circle ${c.b(ci.name)}` +
        (revoked ? c.dim(`  ${revoked} derived facts revoked`) : ""),
    );
    recomputeScores();
    return;
  }

  die("people circle [list|create|add|remove|show|classify|delete]");
}

// A circle-derived fact is written onto every member, and revoked when
// membership changes or the circle is deleted. Provenance lives in
// source_circle_id so the revoke is exact rather than a guess at the text.
function syncCircleFacts(circleId) {
  const d = db();
  const ci = d.prepare("SELECT * FROM circles WHERE id=?").get(circleId);
  if (!ci || !ci.classified_fact) return 0;
  d.prepare(
    "UPDATE observations SET deleted_at=? WHERE source_circle_id=? AND deleted_at IS NULL",
  ).run(nowISO(), circleId);
  if (ci.deleted_at) return 0;
  const members = d.prepare("SELECT person_id FROM circle_members WHERE circle_id=?").all(circleId);
  // A circle is a social grouping by construction, so its derived fact is
  // social evidence regardless of what the circle is about. The body text
  // carries the topic; the dimension carries how you know these people.
  const dimCode = "social";
  let n = 0;
  for (const m of members) {
    insertObservation({
      personId: m.person_id,
      body: ci.classified_fact,
      flags: { source: "inferred", temporal: "permanent", dim: dimCode },
      sourceCircleId: circleId,
    });
    n++;
  }
  return n;
}


// ---------------------------------------------------------------- classify
// 154 group chats with names like "Thor HW" and "Champa Chompers" and nothing
// recording what they actually are. The messages say: who is in it, what it is
// for, and whether it is still alive.

const CLASSIFY_SYSTEM =
  "You describe what a group chat is, from its messages. " +
  "You reply with a JSON object and nothing else: no preamble, no prayer.";

async function classifyCircle(d, circle, model) {
  const msgs = d
    .prepare(
      `SELECT body FROM messages
        WHERE who = ? AND body IS NOT NULL AND length(body) BETWEEN 12 AND 240
        ORDER BY random() LIMIT 70`,
    )
    .all(circle.name);
  if (msgs.length < 5) return null;

  const members = d
    .prepare(
      `SELECT p.name FROM circle_members cm JOIN people p ON p.id = cm.person_id
        WHERE cm.circle_id = ? AND p.deleted_at IS NULL LIMIT 25`,
    )
    .all(circle.id)
    .map((r) => r.name);

  const span = d
    .prepare("SELECT min(sent_at) AS a, max(sent_at) AS b FROM messages WHERE who = ?")
    .get(circle.name);

  const prompt = [
    `Group chat name: ${circle.name}`,
    `Members: ${members.join(", ") || "unknown"}`,
    `Active: ${String(span.a).slice(0, 10)} to ${String(span.b).slice(0, 10)}`,
    "",
    "A sample of messages:",
    ...msgs.map((m) => `- ${m.body.replace(/\s+/g, " ")}`),
    "",
    "What is this group? One sentence a stranger would understand, naming the",
    "shared context: a class, a team, a church, a trip, a family, a project.",
    "",
    "Then its kind, from exactly this list and no other word:",
    "  affiliation  a standing group you belong to: a family, a team, a class,",
    "               a club, a church, a cohort, a company.",
    "  experience   a group formed around something that happened or will:",
    "               a trip, an event, a one-off project, a wedding.",
    "  interest     a group formed around a shared thing you like.",
    "  other        none of the above fits.",
    "",
    'Reply with only: {"what": "one sentence", "kind": "affiliation|experience|interest|other"}',
  ].join("\n");

  const out = await claudeJSON(prompt, CLASSIFY_SYSTEM, model);
  if (!out) return null;
  const a = out.indexOf("{");
  const b = out.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(out.slice(a, b + 1));
  } catch {
    return null;
  }
}

async function cmdClassify(argv) {
  const { flags } = parseArgs(argv);
  const d = db();
  const model = flags.model || "claude-sonnet-5";

  const todo = d
    .prepare(
      `SELECT c.id, c.name FROM circles c
        WHERE c.deleted_at IS NULL ${flags.all ? "" : "AND c.classified_fact IS NULL"}
        ORDER BY (SELECT count(*) FROM messages m WHERE m.who = c.name) DESC`,
    )
    .all();
  if (!todo.length) return say(c.grn("  every circle is classified"));

  const work = todo.slice(0, Number(flags.limit) || todo.length);
  say("");
  say(`${c.b("classify")} ${work.length} circles`);

  const width = Math.max(1, Math.min(Number(flags.concurrency) || 4, 12));
  let cursor = 0, done = 0, named = 0;
  const upd = d.prepare(
    "UPDATE circles SET classified_kind=?, classified_fact=?, classified_at=? WHERE id=?",
  );
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= work.length) return;
      const got = await classifyCircle(d, work[i], model);
      done++;
      if (got && got.what) {
        // The column has a CHECK constraint. A model that answers "family"
        // instead of "affiliation" should cost that row its kind, not kill the
        // whole pass.
        const allowed = ["interest", "experience", "affiliation", "other"];
        const kind = allowed.includes(String(got.kind || "").toLowerCase())
          ? String(got.kind).toLowerCase()
          : "other";
        upd.run(kind, String(got.what).slice(0, 400), nowISO(), work[i].id);
        named++;
        say(`  ${c.cyn(kind.padEnd(11))} ${c.b(work[i].name.padEnd(28))} ${c.dim(String(got.what).slice(0, 72))}`);
      }
      if (done % 20 === 0) say(c.dim(`  ${done}/${work.length}`));
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  say(`${c.grn("classified")} ${named} of ${work.length}`);
}

module.exports = {
  cmdCircle, cmdClassify,
};
