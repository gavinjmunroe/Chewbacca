---
name: feedback_gtm_agent_briefs_name_the_engine
description: A subagent sent to do GTM work (leads, why-now, buyers, emails) is briefed on the engine tool for each kind of work, or dough-brief-gate refuses it
metadata:
  type: feedback
---

Any Agent, Task or Workflow brief that asks for GTM work names the engine tool for each kind of work it asks for: buyers and emails through gtme-lookup or Togari zoominfo plus gtme_score.resolve_primary, why-now through gtme_score.signal_strength or gtme-signals, copy through gtme-grade, and list cleaning through gtme-dnc or gtme-dedupe. `.claude/hooks/dough-brief-gate.sh` refuses a brief missing any of them and hands back the block to paste.

**Why:** on 2026-10-29 the Medrano 145-lead enrichment went to a subagent whose brief named gtme_score and Togari Exa and then said web search was fine for buyers, emails and first emails. gtm-reuse-gate only reads Write, so nothing caught it. Caleb: "Remember to use the DOPE GTM/BMA/TOGARI/CHEWBS/JEV STUFF ... I SHOULD NEVER HAVE TO SAY THIS FIX CHEWBS/DOUHG ... IT SHOULD BE BUILT IN". A count of tool names let that brief through, so the gate checks per kind of work. The real brief is in tests/fixtures/dough_brief/corpus.json.

**How to apply:** for a list build, start from `chewbacca gtme accounts --client <slug>` once it's on main (the Make Dough tab owns it). Related: [[feedback_dough_is_the_built_engine]].
