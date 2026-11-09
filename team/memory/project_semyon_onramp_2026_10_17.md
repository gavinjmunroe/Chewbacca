---
name: project_semyon_onramp_2026_10_17
description: Semyon (Chewbacca backend, installer and guard tasks) has a one-page onramp to Chewbacca and the Clay bridge; Caleb asked for it 2026-10-17, not yet sent
metadata:
  type: project
---

Semyon is the Chewbacca team's backend member (`team/members.json`, no GitHub
handle filled in). His board tasks are the installer (CHW-1, 2, 8, 126, 143,
145, 146, 147) and the guard layer (CHW-165 list-guard never exits 2, CHW-174
deliverability caps). He knows the idea (Chewbacca automates Clay through a
bridge so nobody opens Clay) but not how Clay itself works.

On 2026-10-17 Caleb asked for a one pager to get him started. It's at
`~/Downloads/Semyon Chewbacca onramp.pdf` (one page) with an editable `.md`
beside it. The order it teaches:

1. Clay in five minutes: tables and credits, audiences, Sequencer campaigns,
   workflows with webhook triggers, and the four failures most of the code
   guards against (bounces, wasted credits, double emails, untrue lines).
2. The bridge: `chewbacca clay ops`, then `chewbacca clay <op>`, routes in
   `library/clay-api/registry.json`, code in `bin/chewbacca-clay`.
3. The guardrails he'll work on, which are launch-guard plus the
   `gtme presend` and `gtme-grade` checks before any campaign starts.
4. Days 1 to 3: CODEBASE.md mental model and GLOSSARY, the clay-navigation
   skill's paid-for mistakes list, run reads, then ship CHW-165 test first.
5. Prompts to paste into Claude in the repo, since he works through Claude.

Status 2026-10-17: written, not sent. Caleb had no phone or handle for
Semyon on file here. Check before assuming he has it.
