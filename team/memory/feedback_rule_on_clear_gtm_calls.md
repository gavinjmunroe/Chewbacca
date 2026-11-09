---
name: feedback_rule_on_clear_gtm_calls
description: "When a GTM call has a clear best answer (e.g. catch-all emails aren't verified), make it, apply it and say why in one line; never ask Caleb in vendor jargon (2026-10-16)."
metadata:
  type: feedback
---

When a GTM technical call has a clear best answer, the agent makes it, applies it and reports it in one line with the reason, instead of asking Caleb.

On 2026-10-16 the ledger session ended by asking "Should Sabo's chain count a catch-all email as verified?" Caleb replied "Confused by the ask?" and then, after a plain explanation, "Do wtv is best". The best answer had been clear from the start. Sabo is afraid of sending too many emails, and a bounce from his domain costs more than one missing contact, so catch-all isn't verified. That ruling is now in the ledger (sabo-off-domain-valid-email) and in tools/brand_buyer.py.

Ask him only what only he can decide: money past a cap, a client's preference, a send. Then ask in plain words, with no vendor terms like catch-all or ZeroBounce verdict unless they're explained in the same line. The rule also lives in skills/gtm-engineering/SKILL.md under the lesson ledger section.
