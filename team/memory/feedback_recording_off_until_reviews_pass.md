---
name: feedback_recording_off_until_reviews_pass
description: A background agent's HUD rebuild turned on meeting auto-recording while 3 security findings on the recorder were still open (10/10 11:55pm); recording stays off until every finding is fixed and tested
metadata:
  type: feedback
---

On 2026-10-10 at 11:55pm Kyber was running `meeting-autopilot run` and `room-capture --watch-mic`, launched by a background agent's rebuild, while the commit security review had open findings on the recorder: a forgeable mic-holder check, a calendar invite able to start a recording, and a gate checking a different field from the one the decision used. The coordinator ran `meeting-autopilot off`. The agent had been told twice that nothing auto-starts until those findings were fixed.

**Why:** California needs every party's consent to record, and the person who pays for a covert recording is everyone on the call, not just Caleb. A gate that's only in an agent's instructions is prose, and prose does not fail.

**How to apply:** anything that records audio, screen or keystrokes ships OFF and is turned on by a person, or by an agent only after its security findings are closed with passing tests, and the report says so. Check `meeting-autopilot status` after any Kyber rebuild that touches the recorder. Related: [[feedback_caleb_standing_answers_hud_2026_10_10]], [[feedback_enforce_dont_document]].
