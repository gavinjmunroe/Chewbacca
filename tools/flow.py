#!/usr/bin/env python3
"""Treat the thing as a graph of states, because that is what a designer edits.

Caleb, 2026-09-20: *"Creative ways to go about structuring pages, button leads
to this leads to that, the way claude does it natively is very very very
limited."*

WHY CLAUDE IS LIMITED AT THIS, MECHANICALLY. A model emits a token stream in
document order. It never holds the artifact as a set of decisions, so there is
nothing to vary except the surface. That is why the colour stances in
stances.py changed the palette and left hero / three-card grid / testimonials /
CTA completely intact: the structure was never a variable, so nothing could
move it. A designer holds "this button goes here, which means that screen
cannot exist." That is a graph, and a graph can be transformed.

THE CATALOGUE IS THE POINT. Deriving a flow is easy and a model does it fine.
What a model does not do on its own is ask whether this should be three screens
or one, whether the commitment should come before or after the action, or
whether to act first and offer an undo. Those are TRANSFORMATIONS on the graph,
there is a finite number of them worth knowing, and each one changes the
product rather than the styling.

Every transformation below carries what it costs, because a move with no cost
is a move nobody needed to think about, and listing only upside is how a tool
starts lying.
"""
import json
import re
import subprocess
import tempfile

# Each: what it does to the graph, when it is the right call, what it costs.
TRANSFORMS = {
    "collapse": {
        "does": "Merge consecutive states into one screen.",
        "when": "The steps share context and the user already has every input in hand.",
        "costs": "Density rises and error recovery gets harder, because one failure "
                 "now means re-reading the whole screen to find it.",
        "example": "A 4-step checkout wizard becomes one page with four sections.",
    },
    "split": {
        "does": "Break one state into several, one decision per screen.",
        "when": "Decisions are independent, or one answer changes what comes next.",
        "costs": "More total time and more places to abandon. Each added screen is "
                 "a drop-off point.",
        "example": "One dense signup becomes email, then plan, then payment.",
    },
    "invert-commitment": {
        "does": "Act immediately and offer undo, instead of confirming first.",
        "when": "The action is cheap to reverse and is performed often.",
        "costs": "Needs real undo in the backend, not a toast that lies. If undo "
                 "cannot actually reverse it, this is a trap.",
        "example": "Archive happens instantly with an Undo toast; no 'are you sure'.",
    },
    "defer": {
        "does": "Make the irreversible thing reversible with a grace period.",
        "when": "Irreversibility is the only reason the flow has friction in it.",
        "costs": "The user may not understand it has not happened yet, and a grace "
                 "period can itself read as a retention gate.",
        "example": "Account deletion schedules for 30 days instead of firing now.",
    },
    "front-load": {
        "does": "Move the decision earlier, before the user invests effort.",
        "when": "A late answer can invalidate work already done.",
        "costs": "Asks for a decision before the user has the context to make it.",
        "example": "Pick the plan before configuring, not after.",
    },
    "defer-identity": {
        "does": "Let the user do the thing first and create the account later.",
        "when": "The value is demonstrable before any account is needed.",
        "costs": "Anonymous state has to be migrated on signup, and losing it is "
                 "worse than having asked up front.",
        "example": "Build the whole document, sign in only to save it.",
    },
    "make-state-visible": {
        "does": "Show the whole path and the current position in it.",
        "when": "The flow is longer than about three steps.",
        "costs": "Seeing seven steps causes abandonment that not seeing them would "
                 "not have. Honest, and sometimes expensive.",
        "example": "A stepper across the top, current step marked.",
    },
    "remove-the-screen": {
        "does": "Delete a state entirely by inferring or defaulting its input.",
        "when": "A sensible default is right most of the time and is editable later.",
        "costs": "A wrong inference the user does not notice is worse than a "
                 "question they had to answer.",
        "example": "Detect currency instead of asking; let them change it in settings.",
    },
    "branch-by-answer": {
        "does": "Route to genuinely different paths based on an early answer.",
        "when": "Two user types need materially different things.",
        "costs": "Two paths is two products to maintain and test.",
        "example": "'Are you a team or solo' routes to different onboarding entirely.",
    },
    "recover-in-place": {
        "does": "Handle failure inside the current state instead of a new screen.",
        "when": "Almost always, for validation and retryable errors.",
        "costs": "Very little. This one is close to a free win, which is why its "
                 "absence is usually an oversight rather than a decision.",
        "example": "Inline field error with focus moved to it, not an error page.",
    },
}

DERIVE = """Map this as a flow, not as a page:

{brief}

Return strict JSON, no markdown fence:

{{
  "states": [
    {{"id": "kebab-id", "what_user_sees": "...", "what_user_must_decide": "... or null",
      "reversible": true, "failure_modes": ["what can go wrong here"]}}
  ],
  "transitions": [
    {{"from": "state-id", "to": "state-id", "trigger": "what the user does",
      "guard": "what must be true, or null"}}
  ],
  "commitment_point": "the state id where something becomes hard to undo",
  "assumed_without_asking": ["structural choices you made that were not in the brief"]
}}

The last key matters most. Name the choices you defaulted to: how many screens,
where the confirmation sits, whether an account is required first. Those are
decisions, not givens, and listing them is what makes them available to change."""


def derive(brief, model="sonnet"):
    with tempfile.TemporaryDirectory() as t:
        out = subprocess.run(["claude", "-p", "--model", model, DERIVE.format(brief=brief)],
                             capture_output=True, text=True, timeout=600, cwd=t).stdout
    m = re.search(r"\{.*\}", out, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def apply_prompt(graph, key, brief):
    t = TRANSFORMS[key]
    return (
        f"{brief}\n\n"
        f"Here is the flow as currently assumed:\n{json.dumps(graph, indent=2)}\n\n"
        f"Apply this structural transformation: {t['does']}\n"
        f"It is the right call when: {t['when']}\n"
        f"Its honest cost: {t['costs']}\n\n"
        f"Rebuild the flow with that transformation applied. Change the STRUCTURE, "
        f"not the styling. If the transformation does not actually suit this "
        f"problem, say so plainly instead of forcing it: a transformation applied "
        f"where it does not fit is worse than the original."
    )
