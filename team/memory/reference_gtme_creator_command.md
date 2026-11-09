---
name: reference-gtme-creator-command
description: 'chewbacca gtme creator <client> "<Name>" runs one roster creator end to end (discover, plan, chain, waterfall on misses, spend, tidy); dry run prices each step from the client''s run log'
metadata:
  type: reference
---

`tools/creator_gtm/creator_run.py`, reached as `chewbacca gtme creator <client> "<Creator>" [--brands FILE] [--instagram HANDLE] [--live]`
(2026-10-17). It replaced the hand-typed brand list in run_noah_batch.py plus five tools run by hand.

- Brands come from Instagram posts that tag an @brand next to an ad marker, and from a file the client hands over.
  A brand with no domain on its bio link or in the client's lists is printed and left out, never guessed.
- An Instagram post's date comes from its shortcode: `(id >> 23) + 1314220021721` ms. DBY1Vpjt-oC decoded to
  2024-10-21, but the research had typed 2025-10-15 for it by hand, so decode the date, don't type it.
- An unreadable source prints UNREADABLE and is never read as zero sponsors. On 10/17 api-anything's Chrome
  profile was held by another process, so the Instagram step hasn't been tested live yet.
- The plan never pays twice. It matches a record by name, then by domain ("Strava (owns Runna)" is filed as "strava").
  It reads the table's Status cell for rows from before the record file existed (Gymshark, Barebells, Celsius),
  and copies another creator's found contact to a new row for 0 credits.
- Credit estimates come from the client's own run log (mean 0.92 a brand over 52 Sabo runs) and the waterfall
  price from enrich_catalog. The chain stops before the daily allowance runs out.
- Test: tests/test_gtme_creator.py, the made-up Hearthside client on the fake provider.
