// @ts-nocheck
// Every app `people send` can reply through, and which of them go through the
// local Matrix bridges `chewbacca chat up` runs (mac/lib/matrix.py). One list,
// so send, owed and drafts can never disagree about what --via accepts.

"use strict";

const NATIVE = ["imessage", "whatsapp", "slack", "email"];

// Must match NETWORKS in mac/lib/matrix.py and the bridge ids in
// config/chat/networks.json (tests/chewbacca_chat.sh checks all three).
const BRIDGED = [
  "signal",
  "telegram",
  "discord",
  "instagram",
  "messenger",
  "twitter",
  "gmessages",
  "googlechat",
  "gvoice",
  "linkedin",
  "bluesky",
];

const APPS = [...NATIVE, ...BRIDGED];

module.exports = { NATIVE, BRIDGED, APPS };
