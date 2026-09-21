#!/usr/bin/env python3
"""Derive the organizing principle from the problem, instead of picking one.

Caleb, 2026-09-20: *"Make chewbacca think for itself to be smart and
resourceful, not just do what I say."* And: *"be creative for the world's first
true solution to make ai the best creative designer, not just a regurgitator."*

WHAT WAS WRONG WITH stances.py. Six fixed stances is better than one mode,
because at least the samples start in different regions. It is still a menu
somebody else wrote, and choosing from a menu is the definition of
regurgitating. A designer facing a new problem does not pick from six.

WHAT A DESIGNER ACTUALLY DOES. They name the tension specific to this problem,
the two or three forces that cannot all be maximised, and then the organizing
principle is just a decision about which force wins. The principle falls out of
the tension; it is not selected.

    a pricing page      the buyer wants to know whether they are being tricked,
                        and the seller wants the expensive tier chosen
    a delete button     it must be easy to reach and hard to hit by accident
    a dashboard         everything on it is important to someone, and nothing
                        can be important to everyone

Resolve "everything is important to someone" toward the user and you get a
dashboard the user composes. Resolve it toward the operator and you get a fixed
KPI row. Those are different products, and neither is on a menu.

DIVERGENCE IS THEN STRUCTURAL. Variants that resolve the same tension in
opposite directions cannot converge, because they disagree about what the thing
is for. That is a stronger guarantee than six preset palettes.

WHY THE REFUSALS MUST BE DERIVED TOO. A refusal that does not follow from the
resolution is decoration, and the model drops it. "No gradient" attached to a
principle about information density is arbitrary. "No element that is not
carrying information" follows, and it survives.

stances.py stays, as worked examples of what a resolved tension looks like, and
as a fallback when derivation fails.
"""
import json
import re
import subprocess
import sys
import tempfile

DERIVE = """You are about to design this:

{brief}

Intended outcome:
{intent}

Do NOT design anything yet. Do the step before designing.

FIRST, name the real tensions in this specific problem: the forces that cannot
all be maximised at once, where improving one genuinely costs another. Not
generic ones like "simple vs powerful" that fit any brief. Ones that are true
of THIS thing and would be false of a different page.

THEN, for each tension, resolve it hard in one direction and state the
organizing principle that resolution implies. Different variants must resolve
the SAME tension in OPPOSING directions, or resolve different tensions, so that
they cannot end up as the same design.

THEN, for each, state what that resolution FORBIDS. A refusal has to follow
from the principle. If the principle is about density, "no gradients" does not
follow and does not belong; "nothing on the page that is not carrying
information" does.

Return strict JSON, no markdown fence:

{{
  "tensions": [
    {{"force_a": "...", "force_b": "...", "why_here": "why this is specific to this brief, not generic"}}
  ],
  "variants": [
    {{
      "key": "short-kebab-name",
      "resolves": "which tension, and which side wins",
      "principle": "the organizing principle, 2 to 3 sentences, concrete enough to build from",
      "refuse": ["what this resolution forbids", "...", "..."],
      "risk": "the honest cost of resolving it this way"
    }}
  ]
}}

Give exactly {n} variants. Each must be buildable and each must be a real
position someone would defend, not a strawman to make another look good."""


def derive(brief, intent, n=3, model="sonnet"):
    prompt = DERIVE.format(brief=brief, intent=json.dumps(intent, indent=2), n=n)
    with tempfile.TemporaryDirectory() as t:
        out = subprocess.run(["claude", "-p", "--model", model, prompt],
                             capture_output=True, text=True,
                             timeout=600, cwd=t).stdout
    m = re.search(r"\{.*\}", out, re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not data.get("variants"):
        return None
    for v in data["variants"]:
        # A variant with no refusals is a mood board. Drop it rather than let
        # the model drift back to the mode inside three paragraphs.
        if not v.get("key") or not v.get("principle") or len(v.get("refuse") or []) < 2:
            return None
    return data


def prompt_for(variant, brief):
    # Derived refusals are this problem's craft decisions. The baseline bans
    # are not negotiable per problem, so every prompt carries them too.
    import stances as _st
    refusals = "\n".join(f"- {r}" for r in list(variant["refuse"]) + _st.BASELINE_REFUSE)
    return (
        f"{brief}\n\n"
        f"Follow this organizing principle exactly:\n{variant['principle']}\n\n"
        f"It exists to resolve a specific tension: {variant.get('resolves','')}\n\n"
        f"This design MUST NOT contain any of the following. Each one is a hard "
        f"failure, not a preference:\n{refusals}\n\n"
        f"BOUNDED DEVIATION. Break the conventions this principle names and "
        f"keep every other convention intact. Warren & Campbell (JCR 2014) "
        f"measured that autonomy reads as cool only when the deviation is "
        f"BOUNDED, small or occasional rather than large or perpetual, and "
        f"only when the norm it breaks was unnecessary in the first place. "
        f"Deviating from everything at once reads as weird, not as cool. So "
        f"break the arbitrary norms hard, and leave the functional ones "
        f"alone: a button still has to look pressable, text still has to "
        f"pass contrast, a form still has to say what went wrong."
    )


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="derive organizing principles from a brief")
    ap.add_argument("brief")
    ap.add_argument("-n", type=int, default=3)
    ap.add_argument("--model", default="sonnet")
    a = ap.parse_args()
    d = derive(a.brief, {"purpose": a.brief}, a.n, a.model)
    if not d:
        print("derivation failed", file=sys.stderr)
        sys.exit(1)
    print("TENSIONS IN THIS PROBLEM")
    for t in d.get("tensions", []):
        print(f"  {t['force_a']}  VS  {t['force_b']}")
        print(f"      {t.get('why_here','')}")
    print("\nPRINCIPLES DERIVED FROM THEM")
    for v in d["variants"]:
        print(f"\n  [{v['key']}]  resolves: {v.get('resolves','')}")
        print(f"      {v['principle']}")
        for r in v["refuse"]:
            print(f"      refuses: {r}")
        print(f"      risk: {v.get('risk','')}")
