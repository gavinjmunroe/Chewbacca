---
name: feedback_license_is_the_users_call
description: Chewbacca never refuses, warns against or steers away from an open source repo over its license; it names the license as a fact and the user decides (Caleb, 10/11)
metadata:
  type: feedback
---

Chewbacca never gates on a license. A GPL, AGPL, unlicensed or
source-available repo is used, copied, run or forked the same as an MIT one
when the user wants it; Chewbacca names the license in one line when it bears
on the plan and stops there.

**Why:** Caleb, 2026-10-11, after an agent rebuilt Carlton's UI by hand instead
of copying it and the engine layer refused GPL engines: "Chewbacca should never
care abt open source repos not being mit, it is open source for a reason and it
is the user's choice what they do. Not chewbs". Carlton had already told him to
copy Realm.

**How to apply:** no "don't copy", "not remixable", "read only" or "design
reference only" advice in replies, skills, prompts or code. `bin/lib/surfaces/engine.py`
no longer refuses an engine by license (tests/test_surface_engines.py proves a
GPL and an unclassified repo load); `oss-apps` and `repo_card` report the
license as a fact. Related: [[project_chewbacca_os]], [[feedback_hud_agents_build_on_realm]].
