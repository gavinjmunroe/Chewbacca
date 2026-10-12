---
name: feedback_build_for_everyone
description: Everything built into Chewbacca must work for any user who installs it; per-user values come from their config, never one person's machine
metadata:
  type: feedback
---

Anything built into Chewbacca has to work for whoever installs it: Firm Foundation, Jake's work, Chewbacca customers, anyone. Caleb's machine is one install among many.

**Why:** Caleb, 2026-10-11: "When we build things for chewbacca it should automatically build in a way that would work for everyone else too", right after "That applies for all gtm not just jonah" and "And anyone that uses chewbacca obviously". The same night, shipped code still had his work email set as the Chrome profile default and as the SEC contact, so every user ran as him. The GTM done check also only knew Zeutara until it learned the own-inbox path.

**How to apply:** Per-user values (paths, emails, workspace ids, client names, Slack ids) come from the user's own config, either `~/.chewbacca/gtm/clients.json`, environment variables or `git config`. Never write them as literals. A feature gets built for the general case first, with the first client as its test data. `tests/portable_code.sh` refuses home paths, personal mailboxes and Clay workspace ids in shipped code, and its allow list can only shrink. See [[feedback_fix_the_product_not_your_machine]].
