#!/usr/bin/env python3
"""Six organizing principles, each with the refusals that make it real.

Caleb, 2026-09-20: "Good design isn't just avoiding bad design. It requires
thinking how could this be done in a way that is unique? What would a few of
the most creative ppl on earth propose and which path is the best?"

Everything else in this repo is subtractive and caps out at "not slop". This
is the generative half.

WHY STANCES AND NOT "BE CREATIVE". Asking a model to be creative moves it from
one mode to another: the stereotype of creative, which is a gradient mesh, a
glass card and brutalism worn as a costume. Sampling the same prompt N times
does not help either, because N samples from one distribution cluster at that
distribution's mode. The fix is to partition the space first and draw once per
cell, so the samples start in different regions instead of racing to the same
one. tools/diversity.py measures whether that actually happens.

WHY THESE SIX. Each is a decision some studio actually committed to, abstracted
from the corpus in systems/ as a KIND of decision rather than a palette. That
is the difference between stance transfer and copying: Bugatti's logic is "one
voltage against near-black, refuse rounding", and that logic can be applied to
a payroll app without borrowing a single Bugatti colour.

The refusals are the load-bearing part. A stance with no refusals is a mood
board, and the model will drift back to the mode inside three paragraphs.
"""

STANCES = {
    "one-voltage": {
        "principle": (
            "Exactly one saturated colour in the entire interface, used only for the "
            "single most important action on the page. Everything else is neutral. "
            "The accent earns its power by being rare."),
        "refuse": ["a second accent colour", "any gradient", "any coloured text "
                   "that is not the accent", "soft drop shadows"],
        "from": "the logic behind bugatti, stripe, vercel: scarcity of colour as hierarchy",
    },
    "typographic": {
        "principle": (
            "Hierarchy is carried entirely by type size, weight and spacing in one "
            "family. Colour communicates nothing. There are no cards and no boxes: "
            "grouping is done with space alone."),
        "refuse": ["cards", "borders around content groups", "coloured headings",
                   "box shadows", "more than one font family"],
        "from": "the logic behind editorial and documentation systems",
    },
    "dense-instrument": {
        "principle": (
            "Built for someone who looks at this for eight hours a day. Maximum "
            "information per screen, small type, tight rows, horizontal rules "
            "instead of cards, tabular numerals aligned on the decimal."),
        "refuse": ["a hero section", "padding above 16px", "border radius above 4px",
                   "decorative illustration", "marketing copy"],
        "from": "the logic behind bloomberg and trading terminals",
    },
    "editorial": {
        "principle": (
            "An asymmetric grid with a serif display face at large size, generous "
            "line measure, and content that begins immediately. Reads like a "
            "magazine spread, not a product page."),
        "refuse": ["a centred hero", "an equal-width three-column feature grid",
                   "filled pill buttons", "icon bubbles"],
        "from": "the logic behind theverge and print-derived systems",
    },
    "material": {
        "principle": (
            "Flat blocks of colour with hard edges and hard offset shadows, like "
            "printed signage. Nothing is soft, nothing blurs, everything has a "
            "definite edge and a definite weight."),
        "refuse": ["soft or blurred shadows", "any gradient", "backdrop blur",
                   "border radius above 4px", "translucency"],
        "from": "the logic behind swiss and signage-derived systems",
    },
    "quiet-utility": {
        "principle": (
            "Near-monochrome. Every measurement lands on a strict 8px grid. No "
            "decoration exists at all: if an element is not carrying information "
            "or an action, it is not on the page."),
        "refuse": ["any saturated colour", "any shadow", "any gradient",
                   "icon bubbles", "illustration"],
        "from": "the logic behind braun and rams-derived systems",
    },
}


# Refusals that hold regardless of stance.
#
# MEASURED 2026-09-20. Across 10 unguided samples and 4 stance-guided pages,
# 83 of all blocking findings were a single rule: emoji standing in for an
# icon. Stance guidance did not reduce findings at all (unguided mean 7.5
# blocking, guided 7.8), because every refusal list was about colour and
# layout and none of them mentioned emoji. The model reaches for emoji by
# default and nothing was telling it not to.
#
# A per-stance refusal is a craft decision and belongs to that stance. A
# universal ban is not a craft decision and has to be carried by every prompt,
# or it is carried by none of them.
BASELINE_REFUSE = [
    "emoji used as an icon or a bullet, anywhere, for any reason",
    "invented statistics, user counts, or 'trusted by N' social proof",
    "fabricated testimonials with invented names",
    "em dashes in any copy",
    "placeholder copy such as lorem ipsum or 'Feature one'",
]


def prompt_for(stance_key, brief):
    s = STANCES[stance_key]
    refusals = "\n".join(f"- {r}" for r in list(s["refuse"]) + BASELINE_REFUSE)
    return (
        f"{brief}\n\n"
        f"Follow this organizing principle exactly:\n{s['principle']}\n\n"
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
