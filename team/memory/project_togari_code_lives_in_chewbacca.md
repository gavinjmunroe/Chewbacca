---
name: project_togari_code_lives_in_chewbacca
description: All Togari code lives in chewbacca/togari; Chewbacca clients never use a Togari repo, and platform/ is the live backend
type: project
---

Every Togari repo was copied into `togari/` in this repo on 2026-10-19, with Karthik's
OK, so Chewbacca clients never depend on a Togari repo and Chewbacca can deploy its own
copy later. Caleb: "For chewbs clients we will not be using the togari repo to keep
things clean, so literally all things needed from togari should be in chewbs".

`togari/platform/` is the live backend (the code behind togari-bma-prod on Railway),
copied from bluemodernadvisory/togari-platform main at cb67af6. The other folders are
older lineages: search (PeopleRank), sandbox, dedup, gtm-os, frontend, mcp-v1
(Karthik's TogariMCP), monorepo-feb. `togari/README.md` maps each to its source commit.

Copy from the remote's main, never the local checkout: the local togari-platform clone
was 61 commits behind its own origin/main, and amber-search was 23 behind.

Two things were kept out. TogariMCP's `.env.example` carried a live Anthropic key and a
live Structify key, both still needing rotation. The frontend mock
`company_contacts.json` held 119 real 48North prospects with cell numbers, and 14
people (Ryan Korn of Zeutara among them) can read this repo, so it ships as `[]`.
Two Clay webhook URLs in `platform/docs` were cut the same way.

Landing it took four tries. `chewbacca land` prints only the last 1,500 characters of
a refused push, so the failing check scrolled off and a passing line looked like the
culprit. When a land refusal names a check that passes by hand, rerun the gate on a
scratch commit (`.githooks/pre-push` with the ref line on stdin) to see the real FAIL.
Here it was pre-push compiling `togari/search/Dockerfile` as Python because line one
said "python"; it now needs a shebang (`tests/pre_push_shebang.sh`).
