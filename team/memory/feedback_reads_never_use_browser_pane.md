---
name: feedback_reads_never_use_browser_pane
description: Public reads (search pages, archives, whois, listings) go through curl or WebFetch; every new host opened in the built-in browser pane pops an allow card Caleb has to click, even in bypass mode
metadata:
  type: feedback
---

On 2026-10-23 a research tab opened tmsearch.uspto.gov, a StartupTree form and web.archive.org in the built-in browser pane, one new host each. Bypass permissions doesn't cover the pane's per-site allow card, so every host stopped Caleb, and he wrote "BRO FIX CHEWBS/CLAUDE WHY DO YOU KEEP ASKING FOR PERMISSION?"

**Why:** the site allowlist belongs to the user (Settings), so an agent can't switch it off. The only fix an agent controls is not triggering it.

**How to apply:** for any public read, use curl (whois, dig, the Wayback `id_` raw URL, CDX API) or WebFetch first. Open the browser pane only for a page that truly needs JS AND a click, and only on a host already opened in this session. If a JS-only page blocks a read, say what's missing instead of opening a new host. Related: [[feedback_sites_renew_never_open]], [[feedback_shared_artifact_read_via_browser]]
