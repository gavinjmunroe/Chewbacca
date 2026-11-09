---
name: reference-chewbacca-privacy-reality
description: What is actually true about Chewbacca privacy as of 2026-09-18: retrieval is fully local with zero LLM calls, nothing is encrypted at rest, and asking Claude does send data to Anthropic.
metadata:
  type: reference
---

2026-09-18. Karthik asked whether everything could be encrypted or fully
localized so LLM calls never see it. Caleb answered "you can set yours up to
store it in that way," which was wrong on both halves. Verified against the code
and the kit's own docs.

**True and stronger than anyone realized:** `bin/people` is 7,957 lines with
**zero `fetch(` calls and zero LLM calls.** `people who` answers from SQLite with
regex facets. The only outbound hosts in the whole file are `localhost`,
`apple.com`, and `api.clay.com` for opt-in enrichment. **The retrieval layer
never touches a model.**

**False as previously claimed:**

- `docs/guide/PRIVACY.md:29` "Nothing is encrypted at rest. Anything running as your
  user can read all of it."
- `docs/guide/PRIVACY.md:36` "If you ask about your texts, the relevant texts are in
  that request" to Anthropic.
- `docs/guide/PRIVACY.md:56` "No redaction layer before content reaches a model. No
  local-model path for sensitive work."

**Fixed 2026-09-18:** `people.db` was `-rw-r--r--`, readable by anything on the
machine. Now `600`, directory `700`.

**Proved 2026-09-18:** a fully local stack works end to end. Local SQLite to
local deterministic query to `llama3.1:8b` via Ollama, real answer, nothing
leaves the machine. Ollama is already installed with `llama3.1:8b`,
`llama3.2:latest` and `qwen2.5vl:3b`.

**The honest framing, and the one to sell:** two modes. Ask Claude about your
people and that context goes to Anthropic, which is Claude Code itself and is not
patchable. Use the CLI or a local model and nothing leaves. The user picks per
query.

**Still missing:** encryption at rest (SQLCipher, and it stops a stolen disk but
not a process running as that user), a `--local` sensitive mode routing through
Ollama, and an audit log of what was sent where. Backlog items 549 to 552 and
570 in `docs/plans/1000.md`.

**Copy rule that came out of this:** never write "nothing uploads" or "your data
never leaves your machine" in outbound. Documented in `amber-outbound/CAMPAIGNS.md`.

Related: a private note,
[[project_chewbacca_amber_positioning_2026_09_18]], [[project_chewbacca_live_checks]]
