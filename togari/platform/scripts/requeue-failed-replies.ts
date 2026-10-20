/**
 * Put failed replies back on the queue.
 *
 *   npx tsx scripts/requeue-failed-replies.ts                   # dry run
 *   npx tsx scripts/requeue-failed-replies.ts --apply
 *   npx tsx scripts/requeue-failed-replies.ts --apply --limit=10
 *   npx tsx scripts/requeue-failed-replies.ts --apply --row=<row_id>
 *   npx tsx scripts/requeue-failed-replies.ts --apply --skip-auto-replies
 *
 * 'failed' is terminal: nothing in the sweeper looks at those rows again, so a
 * reply that failed for a reason since fixed stays unanswered until someone
 * runs this. That happened on 2026-09-22 — every dispatch was refused, the
 * rows were failed for having no thread to chase, and 42 replies sat there.
 *
 * Dry run by default, because this is the one tool that can put work back into
 * a paid pipeline in bulk. --apply is the only thing that writes.
 *
 * Re-queuing a row means it is dispatched to Perplexity again and, if it comes
 * back drafted, posts a Slack card. Only run it when whatever broke is fixed —
 * a batch sent into a still-broken pipeline just fails the same way, at cost.
 */

import { loadDotEnv } from "./load-env";

loadDotEnv();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=").trim() || undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/**
 * Out-of-office and "I've left the company" notices.
 *
 * A convenience for the common case of a backlog that is mostly conference
 * auto-replies, not a classifier — it reads the body, and anything it is
 * unsure of is kept rather than dropped. Off unless asked for, because
 * deciding a real reply is an auto-reply costs a prospect.
 */
const AUTO_REPLY = new RegExp(
  [
    "out of (the )?office",
    "\\booo\\b",
    "away from (the|my) (office|desk)",
    "on (pto|leave|vacation)",
    "currently (out|away|travel)",
    "no longer (with|working)",
    "has transitioned out",
    "attending .{0,40}conference",
  ].join("|"),
  "i",
);

async function main(): Promise<void> {
  const { findFailedRows, requeueReply } = await import("../src/replies/store");

  const apply = has("apply");
  const limit = Number(arg("limit") ?? 500);
  const only = arg("row");
  const skipAuto = has("skip-auto-replies");

  let rows = await findFailedRows(limit);
  if (only) rows = rows.filter((r) => r.row_id === only);

  if (rows.length === 0) {
    process.stdout.write("Nothing in state 'failed'.\n");
    return;
  }

  const skipped = skipAuto ? rows.filter((r) => AUTO_REPLY.test(r.body)) : [];
  const chosen = rows.filter((r) => !skipped.includes(r));

  process.stdout.write(
    `${rows.length} failed row(s)` +
      (skipAuto ? `, ${skipped.length} look like auto-replies and are left alone` : "") +
      `\n\n`,
  );

  for (const r of chosen) {
    const head = r.body.replace(/\s+/g, " ").slice(0, 70);
    process.stdout.write(`  ${r.row_id}  ${r.from_address ?? "?"}\n     ${head}\n`);
  }

  if (!apply) {
    process.stdout.write(
      `\nDry run. ${chosen.length} row(s) would go back to 'queued'.\n` +
        `Re-run with --apply once Perplexity is known to be working — each of ` +
        `these becomes a paid dispatch and, if drafted, a Slack card.\n`,
    );
    return;
  }

  let requeued = 0;
  let refused = 0;
  for (const r of chosen) {
    // requeueReply refuses a row that reached 'done' in the meantime; that is
    // a result landing late, not an error, and its card already exists.
    if (await requeueReply(r.row_id)) requeued++;
    else refused++;
  }

  process.stdout.write(
    `\n✓ ${requeued} re-queued` +
      (refused ? `, ${refused} skipped (already done)` : "") +
      `\nThe sweeper picks them up on its next pass — ` +
      `REPLY_SWEEP_ENABLED must be true for that to happen.\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
