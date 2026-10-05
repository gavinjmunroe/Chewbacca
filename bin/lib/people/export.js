// @ts-nocheck
// people export and sync: the markdown export, and the opt-in git sync of
// $PEOPLE_DIR.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { c, die, say, parseArgs } = require("./output");
const { DIR, db, nowISO } = require("./db");

// ---------------------------------------------------------------- export

function cmdExport(argv) {
  const { flags } = parseArgs(argv);
  const out = flags.out || path.join(DIR, "export");
  const d = db();
  fs.mkdirSync(path.join(out, "people"), { recursive: true });
  fs.mkdirSync(path.join(out, "circles"), { recursive: true });

  const slug = (s) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "untitled";

  let n = 0;
  for (const p of d.prepare("SELECT * FROM people WHERE deleted_at IS NULL ORDER BY name").all()) {
    const s = d.prepare("SELECT * FROM person_scores WHERE person_id=?").get(p.id);
    const states = d
      .prepare(
        `SELECT dm.label, st.score FROM person_dimension_state st
           JOIN dimensions dm ON dm.id = st.dimension_id
          WHERE st.person_id=? ORDER BY dm.sort_order`,
      )
      .all(p.id);
    const circles = d
      .prepare(
        `SELECT c.name FROM circles c JOIN circle_members m ON m.circle_id=c.id
          WHERE m.person_id=? AND c.deleted_at IS NULL ORDER BY c.name`,
      )
      .all(p.id);
    const obs = d
      .prepare(
        "SELECT * FROM observations WHERE person_id=? AND deleted_at IS NULL ORDER BY observed_at DESC",
      )
      .all(p.id);

    const fm = [
      "---",
      `name: ${p.name}`,
      p.handle ? `handle: ${p.handle}` : null,
      p.company ? `company: ${p.company}` : null,
      p.role ? `role: ${p.role}` : null,
      p.location ? `location: ${p.location}` : null,
      circles.length ? `circles: [${circles.map((x) => x.name).join(", ")}]` : null,
      s ? `score: ${s.base_score.toFixed(3)}` : null,
      s ? `warmth: ${s.warmth.toFixed(3)}` : null,
      `updated: ${String(p.updated_at).slice(0, 10)}`,
      "---",
      "",
      `# ${p.name}`,
      "",
    ].filter((x) => x !== null);

    const body = [];
    const qf = d.prepare("SELECT key, value FROM quick_facts WHERE person_id=? ORDER BY key").all(p.id);
    if (qf.length) {
      for (const f of qf) body.push(`**${f.key.replace(/_/g, " ")}:** ${f.value}`);
      body.push("");
    }
    const rels = d
      .prepare(
        `SELECT r.kind, p2.name FROM relationships r JOIN people p2 ON p2.id=r.to_id
          WHERE r.from_id=? AND p2.deleted_at IS NULL ORDER BY r.kind`,
      )
      .all(p.id);
    if (rels.length)
      body.push(`**Related:** ${rels.map((r) => `${r.kind} of ${r.name}`).join(", ")}`, "");
    const dts = d
      .prepare("SELECT label, month, day, year FROM important_dates WHERE person_id=? ORDER BY month, day")
      .all(p.id);
    if (dts.length) {
      body.push("## Dates", "");
      for (const x of dts)
        body.push(
          `- ${x.label}: ${String(x.month).padStart(2, "0")}-${String(x.day).padStart(2, "0")}${x.year ? ` (${x.year})` : ""}`,
        );
      body.push("");
    }
    const owed = d.prepare("SELECT title, due_at FROM tasks WHERE person_id=? AND done_at IS NULL").all(p.id);
    if (owed.length) {
      body.push("## You owe them", "");
      for (const t of owed) body.push(`- [ ] ${t.title}${t.due_at ? ` (due ${String(t.due_at).slice(0, 10)})` : ""}`);
      body.push("");
    }
    const ln = d.prepare("SELECT direction, what FROM loans WHERE person_id=? AND settled_at IS NULL").all(p.id);
    if (ln.length) {
      body.push("## Outstanding", "");
      for (const l of ln) body.push(`- ${l.direction === "lent" ? "They have" : "You have"} ${l.what}`);
      body.push("");
    }
    if (states.length) {
      body.push("| Dimension | Score |", "| --- | --- |");
      for (const st of states) body.push(`| ${st.label} | ${st.score.toFixed(2)} |`);
      body.push("");
    }
    if (obs.length) {
      body.push("## What you know", "");
      for (const o of obs) {
        const marks = [o.modality !== "actual" ? o.modality : null, o.kind !== "fact" ? o.kind : null]
          .filter(Boolean)
          .join(", ");
        body.push(`- **${String(o.observed_at).slice(0, 10)}** ${o.body}${marks ? ` _(${marks})_` : ""}`);
      }
      body.push("");
    }
    fs.writeFileSync(path.join(out, "people", `${slug(p.name)}.md`), fm.concat(body).join("\n"));
    n++;
  }

  let cn = 0;
  for (const ci of d.prepare("SELECT * FROM circles WHERE deleted_at IS NULL ORDER BY name").all()) {
    const mem = d
      .prepare(
        `SELECT p.name FROM circle_members m JOIN people p ON p.id=m.person_id
          WHERE m.circle_id=? AND p.deleted_at IS NULL ORDER BY p.name`,
      )
      .all(ci.id);
    const lines = [
      "---",
      `name: ${ci.name}`,
      ci.classified_kind ? `kind: ${ci.classified_kind}` : null,
      "---",
      "",
      `# ${ci.name}`,
      "",
      ci.description || "",
      ci.classified_fact ? `\n> ${ci.classified_fact}\n` : "",
      "## Members",
      "",
      ...mem.map((m) => `- ${m.name}`),
      "",
    ].filter((x) => x !== null);
    fs.writeFileSync(path.join(out, "circles", `${slug(ci.name)}.md`), lines.join("\n"));
    cn++;
  }

  const self = d
    .prepare(
      "SELECT * FROM observations WHERE person_id IS NULL AND circle_id IS NULL AND deleted_at IS NULL ORDER BY observed_at DESC",
    )
    .all();
  if (self.length) {
    fs.writeFileSync(
      path.join(out, "me.md"),
      ["---", "name: me", "---", "", "# Me", ""]
        .concat(self.map((o) => `- **${String(o.observed_at).slice(0, 10)}** ${o.body}`))
        .join("\n") + "\n",
    );
  }

  say(`${c.grn("exported")} ${n} people, ${cn} circles ${c.dim("-> " + out)}`);
}

// ---------------------------------------------------------------- sync

// Returns stdout, or "" when there is none to capture. execFileSync hands back
// null under stdio:"inherit", and calling .trim() on that throws a TypeError
// that reads exactly like the git command itself having failed.
function git(args, opts = {}) {
  const out = execFileSync("git", ["-C", DIR, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  return typeof out === "string" ? out.trim() : "";
}

// For probes where a non-zero exit is a normal answer rather than a problem,
// and git's own stderr would only confuse the person reading it. Keeps stderr
// so the caller can tell WHICH failure happened.
function gitQuiet(args) {
  try {
    return { ok: true, out: git(args, { stdio: ["ignore", "pipe", "pipe"] }), err: "" };
  } catch (e) {
    const err = [e && e.stderr, e && e.stdout].filter(Boolean).join("\n");
    return { ok: false, out: "", err: String(err || (e && e.message) || "") };
  }
}

function cmdSync(argv) {
  const sub = argv.shift() || "push";
  fs.mkdirSync(DIR, { recursive: true });

  if (sub === "init") {
    const url = argv[0];
    if (!url)
      die(
        "Give it a repo:\n  people sync init git@github.com:you/my-people.git\n\nMake it PRIVATE. This is everything you know about everyone.",
      );
    if (!fs.existsSync(path.join(DIR, ".git"))) {
      execFileSync("git", ["init", "-q", DIR]);
      git(["symbolic-ref", "HEAD", "refs/heads/main"]);
    }
    fs.writeFileSync(
      path.join(DIR, ".gitignore"),
      ["people.db-wal", "people.db-shm", ""].join("\n"),
    );
    gitQuiet(["remote", "remove", "origin"]);
    git(["remote", "add", "origin", url]);
    say(`${c.grn("linked")} ${url}`);
    say(c.dim("now: people sync push"));
    return;
  }

  if (!fs.existsSync(path.join(DIR, ".git")))
    die("Not syncing yet. Run: people sync init <private-git-url>");

  if (sub === "pull") {
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "main";
    const pulled = gitQuiet(["pull", "--ff-only", "origin", branch]);
    if (pulled.ok) {
      say(c.grn("pulled"));
    } else {
      die(
        "Pull was not a fast-forward, so both sides have changes.\n" +
          "  The database is binary, so git cannot merge them: one side has to win.\n\n" +
          "  See what differs first:  people sync diff\n\n" +
          "  Take the remote and lose local edits:\n" +
          `    git -C ${DIR} fetch origin && git -C ${DIR} reset --hard origin/${branch}\n\n` +
          "  Keep local and overwrite the remote:\n" +
          `    git -C ${DIR} push --force origin ${branch}`,
      );
    }
    return;
  }

  if (sub === "push") {
    // Export first so the repo carries readable markdown alongside the binary.
    cmdExport([]);
    git(["add", "-A"]);
    const dirty = git(["status", "--porcelain"]);
    if (!dirty) return say(c.dim("nothing changed"));
    const n = db().prepare("SELECT count(*) AS n FROM people WHERE deleted_at IS NULL").get().n;
    git(["commit", "-q", "-m", `people: ${n} people, ${nowISO().slice(0, 10)}`]);
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "main";
    const pushed = gitQuiet(["push", "origin", `${branch}:${branch}`]);
    if (!pushed.ok) {
      // The likely failure is not an unreachable remote, it is the other
      // machine having pushed first. Saying "check you can reach it" sends
      // someone to debug their network when their data is the problem.
      if (/non-fast-forward|rejected|fetch first|behind/i.test(pushed.err))
        die(
          "Another machine pushed first, so this push was rejected.\n" +
            "  The commit is safe here. The database is binary, so git cannot merge\n" +
            "  the two: one side has to win, and you have to pick which.\n\n" +
            "  Keep what is on the remote and lose the edits made here:\n" +
            `    git -C ${DIR} fetch origin && git -C ${DIR} reset --hard origin/${branch}\n\n` +
            "  Keep what is here and overwrite the remote:\n" +
            `    git -C ${DIR} push --force origin ${branch}\n\n` +
            "  Not sure? Read both first:  people sync diff",
        );
      die(
        "Push failed, but the commit is safe on this machine.\n" +
          `  ${pushed.err.split("\n").find((l) => l.trim()) || "no detail from git"}\n` +
          `  Retry by hand with:  git -C ${DIR} push origin ${branch}`,
      );
    }
    say(c.grn("pushed") + c.dim(`  ${n} people`));
    return;
  }

  // The .db is binary and unreadable in a diff, but `sync push` exports markdown
  // beside it, and that IS readable. So when the two machines disagree, compare
  // the exports: it answers "what would I lose" in the only terms that matter.
  if (sub === "diff") {
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "main";
    if (!gitQuiet(["fetch", "origin", branch]).ok)
      die("Could not reach the remote to compare against.");
    const ahead = gitQuiet(["rev-list", "--count", `origin/${branch}..HEAD`]).out || "0";
    const behind = gitQuiet(["rev-list", "--count", `HEAD..origin/${branch}`]).out || "0";
    say("");
    say(`  here has  ${c.b(ahead)} commit(s) the remote does not`);
    say(`  remote has ${c.b(behind)} commit(s) this machine does not`);
    if (ahead === "0" && behind === "0") return say(c.grn("\n  in step\n"));
    const d2 = gitQuiet(["diff", "--stat", `origin/${branch}...HEAD`, "--", "export"]);
    if (d2.out) {
      say("\n" + c.cyn("  what differs, in the readable export"));
      for (const line of d2.out.split("\n")) say("    " + line);
    } else {
      say(c.dim("\n  no differences in the exported markdown"));
    }
    say("");
    return;
  }

  if (sub === "status") {
    say(`  dir     ${DIR}`);
    const remote = gitQuiet(["remote", "get-url", "origin"]);
    say(remote.ok ? `  remote  ${remote.out}` : `  remote  ${c.yel("none")}`);
    const branch = gitQuiet(["rev-parse", "--abbrev-ref", "HEAD"]);
    say(`  branch  ${branch.ok ? branch.out : "main"}`);
    // No commits yet is a normal state on a freshly initialised directory, not
    // an error, and must not be reported as a missing remote.
    const head = gitQuiet(["rev-parse", "HEAD"]);
    if (!head.ok) {
      say(`  state   ${c.yel("nothing pushed yet")}${c.dim("  run: people sync push")}`);
      return;
    }
    const dirty = git(["status", "--porcelain"]);
    say(`  state   ${dirty ? c.yel("uncommitted changes") : c.grn("clean")}`);
    return;
  }

  die("people sync [init <url>|push|pull|diff|status]");
}

module.exports = {
  cmdExport, cmdSync,
};
