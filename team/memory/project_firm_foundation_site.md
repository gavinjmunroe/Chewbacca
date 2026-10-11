---
name: project_firm_foundation_site
description: Firm Foundation site state after the 2026-10-10 night rebuild, where it is deployed, what each page now is, and what is still open
metadata:
  type: project
---

The Firm Foundation site (repo gavinjmunroe/firm-foundation, `site/`, Next.js) was rebuilt with Caleb on 2026-10-10 into one story for a church staffer who clicked through from our email. Home is a pinned hero, then one pinned what-we-do scene (01 front door: a quiet audit grid with one loud "Had all six: None"; 02 what we build: the guest's phone drawn as real apps, three paths and no Before/After toggle; 03 what we run: the stack with Planning Center and the rest wired into the foundation), then 04 "The Monday after" (each Sunday guest looked up into a brief and a drafted text a person approves), then 05 the ask with the four steps. Trust is one signed sheet; Mission is one drawing that changes (tools, then slab, then people) and ends on 2 Timothy 2:19.

**Why:** Caleb rejected each earlier version as a wall of text, a slide deck, one dimensional, a lesser phone version, and repeated lines. The rules and the five site-gate checks (flash, parity, deck, focus, repeat) came from those words; see [[feedback_phone_is_never_lesser]].

**How to apply:** the live preview is https://firm-foundation.up.railway.app (Caleb's Railway workspace, `railway up` from `site/`). firmfoundation.tech is on Gavin's Vercel, which blocks deploys of Caleb's commits, so it shows the old site. On 2026-10-11 firmfoundation.tech and www were added as custom domains on Caleb's Railway service; live once Gavin swaps Porkbun DNS off Vercel (ALIAS @ to axy6b79i.up.railway.app, CNAME www to bb99f5n4.up.railway.app). All of Caleb's commits were already on Gavin's main; the only blocker was Vercel Hobby refusing non-owner commits. Tool names on the site come only from `research/CHURCH-SOFTWARE.md` (Planning Center leads, low-confidence ranking); see [[feedback_vendor_names_need_a_source]]. Every guest and church on the page is an example. Copy lives in `site/lib/content.ts`; `lib/copy.test.ts` caps Home at 610 words. Related: [[project_firm_foundation_founding_2026_10_09]].
