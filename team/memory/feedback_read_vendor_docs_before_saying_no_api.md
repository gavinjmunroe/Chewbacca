---
name: feedback_read_vendor_docs_before_saying_no_api
description: Before saying a tool has no API or can't integrate, read the vendor's own integrations page and API reference, not search snippets
metadata:
  type: feedback
---

A claim that a product has no API, or can't do an integration, needs the vendor's own integrations page and API reference read first (for example api.<vendor>.com, docs.<vendor>.com, /integrations). Third-party guides and search summaries describe old or partial setups.

**Why:** 2026-10-28, after the Junto call, I told Caleb Dripify only sent data out by webhook and had no public API, from a search that returned Zapier guides. He sent dripify.com/integrations. api.dripify.com lists a real Open API with writes: add leads to a campaign, send a message, set custom fields, tag and blacklist leads, read stats and conversations. The tool Caleb promised Reed on the call needs the first three.

**How to apply:** Fetch the vendor's integrations page and API root, list the paths and methods, then answer. Say "I couldn't find one in their docs" only after both were read.

Related: [[project_junto_pilot_2026_10_28]].
