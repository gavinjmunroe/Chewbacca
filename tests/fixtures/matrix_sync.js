// Runs the bridged-chats channel of `people texts sync` alone, against
// whatever PEOPLE_DIR and CHEWBACCA_MATRIX_DIR the caller set. Lives here so
// textsReader resolves mac/lib from this repo (tests/fixtures/../../mac/lib),
// and so iMessage, WhatsApp, Slack and email are never touched by the test.
"use strict";
const path = require("node:path");
const lib = path.join(__dirname, "..", "..", "bin", "lib", "people");
const { syncChannel, CHANNELS } = require(path.join(lib, "texts.js"));
const { db } = require(path.join(lib, "db.js"));
const ch = CHANNELS.find((c) => c.source === "matrix");
process.stdout.write(
  String(syncChannel(db(), ch, { "no-refresh": true, quiet: true, days: 30 })),
);
