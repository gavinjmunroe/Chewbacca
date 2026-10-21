# Newton/agent/scripts/

The scheduled-agent surface. Every recurring Amber task that is not the
main Railway runtime shells through a script in this folder. This is by
design: one path in, one path out, one audit trail.

Right now that is two scripts. Both are intentionally small, boring,
and dependency-free (pure Node, no npm install at runtime).

## send-checkin.js

The canonical send path for every scheduled check-in Amber delivers to
Caleb or Sagar.

**Contract:**
- One CLI call per send. No batching, no daemon.
- Reads `LOOP_API_KEY`, `LOOP_SECRET_KEY`, `LOOP_SENDER_ID`, and the
  recipient-specific phone env var (`CALEB_PHONE` or `SAGAR_PHONE`) from
  the process environment.
- Sends via Loop Message's documented body shape:
  `{ recipient, sender_name, text, passthrough }` with both
  `Authorization` and `Loop-Secret-Key` headers.
- After a successful send, polls
  `https://a.loopmessage.com/api/v1/message/status/{id}/` to verify the
  state is `delivered` / `sent` / `processing`, not merely queued.
- Writes a full audit record to
  `vision/outbox/<YYYY-MM-DD>/<message_id>.json` with the request, the
  response, and the status poll. This is the file the tracer reads.
- Appends the prompt to `vision/inbox/checkin-<kind>-[caleb-]<YYYY-MM-DD>.md`
  so the training pipeline can ingest it.
- Exits `0` on success, `1` on API error, `2` on bad args, `3` on a
  terminal Loop failure status (`failed` / `timeout` / `unknown_sender`).
  Cron wrappers must check the exit code.

**Usage:**

```bash
cd /home/user/workspace/amber/amber-agent
set -a && source /home/user/workspace/amber/.secrets/loop.env && set +a
node Newton/agent/scripts/send-checkin.js \
  --to caleb \
  --dimension emotional \
  --kind morning \
  --text "<the prompt>"
```

**Phase 0 fallback:** if the recipient's phone env var is unset (Sagar
today), the script writes the inbox markdown only and reports
`mode: inbox-fallback`. No Loop call, no outbox record.

## trace-checkins.js

The delivery audit tool. Reads `vision/outbox/` and prints a table of
every check-in attempt we have proof of.

```bash
node Newton/agent/scripts/trace-checkins.js --to caleb --days 7
```

Columns: `stamp · to · kind · dim · status · message_id · text preview`.

Flags:
- `--to caleb | sagar` - filter recipient
- `--kind morning | evening | sunday` - filter kind
- `--days N` - look back N days (default 7)
- `--json` - dump raw records

**The load-bearing claim:** absence from this table is diagnostic. If a
cron run logs success but the tracer returns zero records for that day,
the cron did not actually invoke `send-checkin.js`. It hand-rolled a
POST, or lied, or both. That is always a bug in the cron task body, not
in Loop and not in this script.

## Rules for adding new scheduled scripts

1. Pure Node, no runtime `npm install`. If you need a dependency, vendor
   it or write it yourself.
2. Parse args with a flat `--key value` convention. No commander, no
   yargs, no abbreviations.
3. Every external side-effect (send, commit, PR, DB write) must also
   write a matching audit record under `vision/outbox/`, `vision/inbox/`,
   or `Tiwari/tiwari-training/runs/`. No side effect without evidence.
4. Non-zero exit codes are the only way a cron learns something went
   wrong. Do not swallow errors.
5. Never import from `Newton/agent/lib/` if you can avoid it. Scripts
   are supposed to be runnable on a bare checkout without `npm install`.
   If you must import, pin the import surface small.
