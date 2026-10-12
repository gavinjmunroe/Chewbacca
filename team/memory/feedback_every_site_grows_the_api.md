---
name: feedback_every_site_grows_the_api
description: Every site an agent browses becomes an api-anything op or gets a skip reason; the api-grow hook points taught hosts at their ops and nudges untaught ones once
metadata:
  type: feedback
---

Caleb, 2026-10-11: "Whenever chewbs tries a new site, it should reverse engineer an api so moving forward it gets more and more cracked." Then: "api-anything so goated."

The `api-grow` hook (PreToolUse and PostToolUse on WebFetch, browser navigates, and Bash calls to chewie web, jev-browse, scrape, curl) reads every spec api-anything can call. Before a browse to a host with ops, it names them. After a browse to a host with none, it logs the visit in `~/.chewbacca/api-grow/visits.json` and tells the agent once per session to teach one read-only op, or run `api-grow skip <host> "<why>"`. `chewbacca api grow` shows the untaught queue.

**Why:** browsing costs 10 to 40 s and several turns every time; a taught op costs about a second, and the next tab inherits it.

**How to apply:** answer the user first, then teach per skills/web-apis. Public, logged-out reads only. Hosts with their own door (GitHub, Google Workspace, the GTM table tool), sign-in pages, his own sites, banks and LinkedIn are never nudged.

Related: [[reference_chewbacca_api]], [[feedback_everything_is_part_of_chewbacca]].
