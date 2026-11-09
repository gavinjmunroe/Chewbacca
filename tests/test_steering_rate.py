"""tools/steering_rate.py labels Caleb's 2026-10-16 messages the way a person did."""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import steering_rate as sr  # noqa: E402

# Real messages from 2026-10-16, hand-labelled in
# team/memory/feedback_caleb_steering_2026_10_16.md.
CASES = {
    "Are you done with your work? There's noting more you could do?": "steer:stopped_early",
    "Lock in bruv": "steer:stopped_early",
    "Peace bro, learn and remember everything you should": "steer:learn_ritual",
    "Why can't you do it?": "steer:missed_capability",
    "I thought we had reverse engineered clay wtf?": "steer:missed_capability",
    "Wait is 1% actually the bar where did u get that": "steer:unchecked_claim",
    "Make sure everythign we do for sabo is repeatable and productizable!": "steer:not_reusable",
    "Wait wtf we should never hv anythign dependent on our computer being open on a loop!": "steer:not_reusable",
    "Bro that's so ai slop": "steer:quality_slop",
    "I approve live Clay runs for Gymshark, Celsius and Barebells: people limit 2": "steer:permission_ask",
    "You haven't been managing them. Plz manage the rest of the day": "steer:not_managing",
    "We good?": "poll",
    "Add hourly verses to the hud popping up": "task",
    "Give me the Friday numbers text for Maggie": "task",
}


def test_labels_match_the_hand_labels():
    wrong = {t: (sr.classify(t), want) for t, want in CASES.items() if sr.classify(t) != want}
    assert not wrong, wrong


def test_counts_only_his_words_and_active_time():
    with tempfile.TemporaryDirectory() as tmp:
        proj = os.path.join(tmp, "p")
        os.makedirs(proj)
        rows = [
            ("2026-10-16T21:00:00Z", "Build the Sabo table"),
            ("2026-10-16T21:05:00Z", "<cross-session-message from=\"x\">Lock in</cross-session-message>"),
            ("2026-10-16T21:06:00Z", "Stop hook feedback:\nLock in"),
            ("2026-10-16T21:08:00Z", "<system-reminder>Linked</system-reminder>\nLock in bruv"),
            ("2026-10-16T23:00:00Z", "We good?"),
        ]
        with open(os.path.join(proj, "s1.jsonl"), "w") as fh:
            for ts, text in rows:
                fh.write(json.dumps({"type": "user", "timestamp": ts,
                                     "message": {"role": "user", "content": text}}) + "\n")
        msgs, active = sr.collect("2026-10-16", os.path.join(tmp, "*", "*.jsonl"),
                                  os.path.join(tmp, "none", "**", "*.jsonl"))
        s = sr.summarize(msgs, active)
        assert [m["label"] for m in msgs] == ["task", "steer:stopped_early", "poll"]
        # 8 minutes of gaps, plus the two-hour gap capped at 10 minutes.
        assert active["s1"] == 8 * 60 + sr.GAP_CAP_S
        assert s["steering"] == 1 and s["polls"] == 1


if __name__ == "__main__":
    test_labels_match_the_hand_labels()
    test_counts_only_his_words_and_active_time()
    print("steering_rate: all passed")
