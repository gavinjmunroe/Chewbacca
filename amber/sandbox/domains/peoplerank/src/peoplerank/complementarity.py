"""
Guest-type complementarity matrix.

Replaces the binary "different type = 1.0, same type = 0.5" rule with a 3x3
matrix grounded in dinner-seat conversation dynamics:

  - Storytellers need listeners to complete the narrative loop. A story told
    to a silent audience lands. This is the strongest pairing.
  - Investigators are social catalysts — they draw out whoever they sit with.
    Pairing an investigator with either a storyteller or a listener is
    productive; investigator+investigator is good but one-dimensional.
  - Two storytellers compete for airtime; neither gets fully heard.
  - Two listeners leave silence; no one initiates.

The values below are INFORMED PRIORS, not tuned weights. They reflect Carlo's
theory about dinner dynamics. Once we have enough labeled events (mutual pick
outcomes), they should be refined from training data. Carlo can push back on
specific values if the theory is wrong; nothing in this file is sacred.

Lookup is case-insensitive on the role_type string. Unknown role types fall
through to a neutral 0.50 default — this preserves behavior for partner
datasets that use different taxonomies.
"""

from __future__ import annotations


# Canonical values. Symmetric — (A, B) == (B, A).
# Keyed by lowercased role strings for case-insensitive matching.
COMPLEMENTARITY_MATRIX: dict[tuple[str, str], float] = {
    # Natural loop — storyteller needs audience, listener needs anchor
    ("storyteller", "listener"):      1.00,
    ("listener", "storyteller"):      1.00,

    # Investigator draws out the story — good
    ("storyteller", "investigator"):  0.85,
    ("investigator", "storyteller"):  0.85,

    # Investigator pulls the listener into the conversation — good
    ("investigator", "listener"):     0.80,
    ("listener", "investigator"):     0.80,

    # Productive but one-note — two catalysts with no one to catalyze
    ("investigator", "investigator"): 0.65,

    # Compete for airtime
    ("storyteller", "storyteller"):   0.45,

    # Silence — nobody initiates
    ("listener", "listener"):         0.35,
}

# Default for unknown role types (e.g., partner taxonomies that don't use
# the Blind8 storyteller/investigator/listener vocabulary). Same as the
# pre-matrix fallback so accuracy does not regress on non-Blind8 data.
DEFAULT_COMPLEMENTARITY = 0.50


def complementarity(type_a: str, type_b: str) -> float:
    """
    Look up the complementarity score for two role types.
    Case-insensitive. Missing / unknown types return DEFAULT_COMPLEMENTARITY.
    """
    a = (type_a or "").strip().lower()
    b = (type_b or "").strip().lower()
    if not a or not b:
        return DEFAULT_COMPLEMENTARITY
    return COMPLEMENTARITY_MATRIX.get((a, b), DEFAULT_COMPLEMENTARITY)
