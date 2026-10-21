#!/usr/bin/env node
/**
 * ACTUALLY SEND ONE, BECAUSE THAT IS THE ONLY DEFINITIVE ANSWER.
 *
 *   railway run node scripts/test-email.js --to you@gmail.com
 *
 * WHY THIS EXISTS RATHER THAN A STATUS CHECK. Resend scopes its API keys.
 * The key that is CORRECT for production has `Sending access` and nothing
 * else -- which means it cannot list domains, cannot read verification
 * status, and cannot answer "will an invitation arrive". preflight asking
 * that question got a 403 and reported the key as revoked, which sent
 * somebody to replace a key that was working perfectly.
 *
 * A sending key can do exactly one thing, so this does exactly that thing
 * and reports what came back. An unverified domain fails with
 * validation_error, a dead key with restricted_api_key or a 401, and a
 * working setup puts an email in an inbox -- which is also the only evidence
 * anybody should accept before telling a room full of people to expect one.
 *
 * SEND IT TO AN OUTSIDE ADDRESS. Resend lets an unverified account mail its
 * own signup address as a courtesy, so a successful send to yourself proves
 * less than it appears to. Gmail, or anything not on the sending domain.
 */

import { sendEmail, sendingDomain, emailConfigured } from "../src/lib/email-delivery.js";

const i = process.argv.indexOf("--to");
const to = i > -1 ? String(process.argv[i + 1] ?? "").trim() : "";

async function main() {
  if (!to || !to.includes("@")) {
    console.log("\n  Usage: node scripts/test-email.js --to someone@gmail.com\n");
    process.exitCode = 1;
    return;
  }

  if (!emailConfigured()) {
    console.log("\n  \x1b[31mRESEND_API_KEY is not set on this service.\x1b[0m\n");
    process.exitCode = 1;
    return;
  }

  const from = sendingDomain();
  console.log(`\n  Sending from ${from} to ${to}…\n`);

  const out = await sendEmail({
    to,
    subject: "Amber: invitation delivery test",
    text:
      "This is a delivery test from Amber.\n\n" +
      "If you are reading it, invitations will reach people. Nothing else to do.\n",
  });

  if (out.ok) {
    console.log("  \x1b[32m✓ Accepted by Resend.\x1b[0m");
    console.log("    Check that inbox — and the spam folder. Accepted is not delivered,");
    console.log("    and a brand new sending domain lands in spam more often than not\n");
    return;
  }

  /*
   * EACH FAILURE NAMED, because they are different afternoons. "Your domain
   * is not verified" and "your key is wrong" look identical as a red box and
   * have nothing in common as a fix.
   */
  const detail = out.detail ?? "unknown";
  console.log(`  \x1b[31m✗ Refused: ${detail} (status ${out.status ?? "?"})\x1b[0m\n`);

  if (detail === "validation_error") {
    console.log(`    ${from} is not verified with Resend yet, so every invitation is refused.`);
    console.log("    resend.com/domains lists the DNS records. They go on " + from + ",");
    console.log("    once, by you — no customer of yours ever adds any of their own.\n");
  } else if (detail === "restricted_api_key") {
    console.log("    This key cannot send. At resend.com/api-keys it needs Sending access.\n");
  } else if (out.status === 401) {
    console.log("    The key is wrong or revoked. Mint one at resend.com/api-keys, then:");
    console.log("      railway variables --set RESEND_API_KEY=re_...\n");
  } else if (out.status === 429) {
    console.log("    Rate limited. Wait a moment and run it again.\n");
  } else {
    console.log("    resend.com/emails shows the attempt and the reason.\n");
  }

  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
