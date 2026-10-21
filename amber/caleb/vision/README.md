# vision/ - Amber's long-memory

This directory is where Amber's founding vision accumulates. It is not
product documentation. It is the written record of what we believe,
why we believe it, and how those beliefs evolve.

## Structure

```
vision/
├── README.md            ← you are here
├── seeds/               ← first-draft ideas, raw voice notes, quick captures
├── inbox/               ← unprocessed material: links, screenshots, transcripts,
│                          quotes the team wants the synthesis agent to absorb.
│                          Scheduled check-ins also land here as markdown with
│                          YAML front-matter (`to`, `dimension`, `kind`, `stamp`).
├── outbox/              ← Loop send audit records, one JSON per message_id.
│                          Gitignored (runtime output). Written by
│                          `Newton/agent/scripts/send-checkin.js` and read by
│                          `Newton/agent/scripts/trace-checkins.js`. Absence of
│                          a record means a scheduled agent did not actually
│                          invoke the canonical send path.
└── synthesis/           ← weekly synthesis runs organized by the six dimensions
    ├── 2026-W16/
    │   ├── spiritual.md
    │   ├── emotional.md
    │   ├── physical.md
    │   ├── intellectual.md
    │   ├── social.md
    │   ├── financial.md
    │   └── meta.md      ← cross-dimension themes + decisions made that week
    └── ...
```

## Cadence

- **inbox/** is written continuously by humans and agents. Drop anything
  in - a link, a paragraph, a Fireflies transcript excerpt, a screenshot
  with a one-line caption. No format required. The daily scheduled
  check-ins also write here.
- **seeds/** is where a founder writes a fresh first-draft idea that is
  too early for a formal spec but too important to lose.
- **outbox/** is a machine-only audit trail. Every time
  `send-checkin.js` fires, it writes `vision/outbox/<YYYY-MM-DD>/<msg-id>.json`
  with the full Loop request, response, and post-send status poll. This
  is how we know a check-in actually delivered, not merely queued.
- **synthesis/** is produced weekly by the synthesis cron (see
  `Newton/agent/scripts/vision-synthesis.js`). The cron reads everything
  in `inbox/` since the last run, organizes it by the six dimensions,
  and opens a draft PR under `synthesis/<ISO-week>/`.

## Rules

1. Never delete anything in `seeds/`, `inbox/`, or `synthesis/`. If
   something becomes outdated, write why in a new inbox entry. Don't
   erase history.
2. The synthesis agent can summarize, cluster, and re-file, but it can
   NEVER modify the original inbox entries.
3. `outbox/` is the only directory that is ephemeral. It is gitignored
   because it is runtime output, not source. It rebuilds itself every
   time a scheduled agent fires.
4. When a seed matures into a shipped decision, cross-link the
   synthesis that captures it from the relevant doc (e.g.
   `docs/PERPLEXITY-AMBER.md`).
5. This directory lives in amber-agent for now. When the GCP server
   comes online, `inbox/` and `outbox/` migrate to GCP with the same
   structure. `synthesis/` and `seeds/` stay in git forever as
   canonical memory.

## Why this exists

On a hundred-year timeline, the code will be rewritten many times. The
philosophy must survive. This directory is the philosophy's home.

See [`docs/PERPLEXITY-AMBER.md`](../docs/PERPLEXITY-AMBER.md) for the
two-hemisphere doctrine that shapes everything written here.
