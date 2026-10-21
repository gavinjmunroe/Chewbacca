/**
 * Tests for markdownToSlack — the GitHub-markdown -> Slack-mrkdwn converter
 * applied to outbound Slack replies so headers and bold render natively.
 *
 * Run with:  node --test Newton/agent/lib/transports/slack/mrkdwn.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { markdownToSlack } from "./mrkdwn.js";

test("headers become bold lines, hashes stripped", () => {
  assert.equal(
    markdownToSlack("# Active Sales Pipeline"),
    "*Active Sales Pipeline*",
  );
  assert.equal(markdownToSlack("## BMA (20 deals)"), "*BMA (20 deals)*");
  assert.equal(
    markdownToSlack("### Closed Won (7 deals)"),
    "*Closed Won (7 deals)*",
  );
});

test("double-asterisk bold becomes single-asterisk Slack bold", () => {
  assert.equal(
    markdownToSlack("**Oshi** - Partnership"),
    "*Oshi* - Partnership",
  );
  assert.equal(markdownToSlack("__bold__ word"), "*bold* word");
});

test("a bold header collapses to a single bold span", () => {
  assert.equal(markdownToSlack("## **TideRock**"), "*TideRock*");
});

test("markdown links become Slack link syntax", () => {
  assert.equal(
    markdownToSlack("see [Scientist.com](https://scientist.com) here"),
    "see <https://scientist.com|Scientist.com> here",
  );
});

test("bullets normalize to the dot glyph, indentation preserved", () => {
  assert.equal(markdownToSlack("- first\n- second"), "• first\n• second");
  assert.equal(markdownToSlack("  - nested"), "  • nested");
});

test("inline code and fenced code blocks are left untouched", () => {
  assert.equal(
    markdownToSlack("use `**not bold**` literally"),
    "use `**not bold**` literally",
  );
  const fenced = "```\n## not a header\n**not bold**\n```";
  assert.equal(markdownToSlack(fenced), fenced);
});

test("non-string and empty inputs pass through unchanged", () => {
  assert.equal(markdownToSlack(""), "");
  assert.equal(markdownToSlack(null), null);
  assert.equal(markdownToSlack(undefined), undefined);
});

test("a realistic multi-line pipeline reply renders cleanly", () => {
  const input = [
    "# Active Sales Pipeline (23 deals)",
    "",
    "## BMA (20 deals)",
    "",
    "### Closed Won (7 deals)",
    "- **Oshi** - Partnership - $4,000/monthly (Owner: Maggie Chen)",
    "- **TideRock** - Partnership - $19,000/monthly (Owner: Sagar Tiwari)",
  ].join("\n");
  const out = markdownToSlack(input);
  assert.ok(!out.includes("#"), "no stray hash headers remain");
  assert.ok(!out.includes("**"), "no stray double asterisks remain");
  assert.ok(out.includes("*Active Sales Pipeline (23 deals)*"));
  assert.ok(out.includes("• *Oshi* - Partnership"));
});
