#!/usr/bin/env node
// JSON in on stdin, JSON out, for callers that aren't ES modules
// (tools/people_amber.py, other repos). One op per call:
//
//   realness  {contacts: [...]}               -> [{id, isReal, confidence, reason}]
//   dupes     {contacts: [...], dismissed}    -> findDuplicateCandidates output
//   mentions  {text, contacts: [...]}         -> [{id, name}]
//   filler    {text}                          -> stripTranscriptFiller output
//   trust     {incoming, existing}            -> {canOverwrite, incoming, existing}
import { classifyRealness } from "./people-rank-realness.js";
import { findDuplicateCandidates } from "./contact-duplicates.js";
import { findMentionedContacts } from "./person-mentions.js";
import { stripTranscriptFiller } from "./transcript-filler.js";
import { canOverwrite, trustOf } from "./source-trust.js";

const op = process.argv[2];
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = raw.trim() ? JSON.parse(raw) : {};
const contacts = Array.isArray(input.contacts) ? input.contacts : [];

const ops = {
  realness: () => contacts.map((c) => ({ id: c.id, ...classifyRealness(c) })),
  dupes: () => findDuplicateCandidates(contacts, {
    dismissed: input.dismissed ? new Set(input.dismissed) : null, limit: input.limit ?? 200 }),
  mentions: () => findMentionedContacts(input.text || "", contacts).map((c) => ({ id: c.id, name: c.name })),
  filler: () => stripTranscriptFiller(input.text || ""),
  trust: () => ({ canOverwrite: canOverwrite(input.incoming, input.existing),
    incoming: trustOf(input.incoming), existing: trustOf(input.existing) }),
};
if (!ops[op]) {
  process.stderr.write(`usage: cli.mjs ${Object.keys(ops).join("|")} < input.json\n`);
  process.exit(2);
}
process.stdout.write(JSON.stringify(ops[op]()) + "\n");
