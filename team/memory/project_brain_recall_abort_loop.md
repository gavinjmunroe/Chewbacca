---
name: project_brain_recall_abort_loop
description: brain-recall was silent on 78% of prompts 10/3 to 10/9 because brain ask's 120ms timeout aborted every Ollama model load; fixed with a detached warm-up, plus incremental indexing and team memory in the index
metadata:
  type: project
---

`brain-recall.sh` (the UserPromptSubmit hook that pulls matching second-brain notes into a prompt) calls `brain ask` from `apps/brain-retrieval`. From 2026-10-03 to 2026-10-09 it came back in lexical mode, and so printed nothing, on 1,674 of 2,140 real prompts. 17 prompts ever showed a hit.

Cause, from Ollama's own server log: loading nomic-embed-text takes ~280ms, `brain ask` gave up at 120ms, and Ollama abandons a load when the client hangs up ("client connection closed before llama-server finished loading, aborting load"). So the ask path could never make the model resident: 568 aborted loads on 10/9 alone. Recall only worked for ~30 min after the 4am index loaded the model.

Fixed 2026-10-09 (3b9196db, ea76e5c5): a timed-out ask starts one detached `brain warm` (lock-guarded across tabs), keep_alive is 2h, `brain index` re-embeds only changed files (4.7s vs 85s) and launchd runs it every 10 min, the kit's `team/memory` is indexed beside the brain, and Ollama is restricted to loopback because every typed prompt is sent to it. `tests/test_brain_index.py` reproduces the abort with a fake Ollama.

**Why:** a client timeout shorter than a server's cold start does not degrade gracefully when the server cancels work on disconnect. It locks the system in the cold state forever, and the fallback hides it.
**How to apply:** when a fast-path timeout guards a model or service that can be cold, make sure something waits out the cold start. Read the hook's shadow log (`~/.chewbacca/state/route-shadow.jsonl`) by gate before trusting that a silent hook is working. Open follow-up: live sealed recall@5 is 50.8% on 701 files vs 68% in September, mostly long hub files under `domains/` winning unrelated queries (apps/brain-retrieval/TODO.md).
