"""What is this query actually asking for?

Stage 1 is a keep/drop filter, and until now it was told only "here is a query,
here are contacts, drop the irrelevant ones." That is the same instruction for
"who is in San Francisco next week", "what does Priya do", and "who would like
this restaurant" -- three questions that need completely different evidence out
of the same contact. The filter had to infer the shape of the question and the
answer at once, from scratch, every time.

This names the shape up front, deterministically, so the filter narrows toward
the right evidence before it starts judging. Cheap on purpose: cue words and
regexes, no model call, so it adds no latency to the request it is meant to make
faster.

MULTIPLE FACETS ARE NORMAL and the union is what we want. "Who is in SF next
week" is PLACE *and* TIME; both instructions apply, and each one narrows a
different axis. When nothing matches we emit nothing and Stage 1 behaves exactly
as it did before -- there is no "unknown" facet, because a wrong hint is worse
than no hint.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple
import re

# label -> (compiled cue pattern, the instruction Stage 1 receives)
_FACETS: List[Tuple[str, "re.Pattern[str]", str]] = [
    (
        "PLACE",
        re.compile(
            r"\b(?:in|near|around|based in|live[sd]? in|from|visiting|around here)\s+[A-Z]"
            r"|\b(?:in|near|around)\s+(?:town|my (?:city|area)|the (?:bay|city|area))\b"
            r"|\b(?:where|which city|what city|nearby|local|locally|in person)\b",
            re.I,
        ),
        "PLACE — the query is about WHERE someone is. Distinguish being BASED "
        "somewhere (a move, a job, a home: true until contradicted) from being "
        "there TEMPORARILY (a visit, a trip, a conference: true only for a "
        "while). A temporary presence counts only if it plausibly still holds; "
        "a fact marked EXPIRED does not answer 'who is there now', though it "
        "does answer 'who has ever been there'.",
    ),
    (
        "TIME",
        re.compile(
            r"\b(?:tonight|today|tomorrow|this (?:week|weekend|month|evening|morning|afternoon)"
            r"|next (?:week|weekend|month|year)|last (?:week|weekend|month|night|year)"
            r"|right now|currently|at the moment|these days|soon|upcoming|this year"
            r"|on (?:mon|tues|wednes|thurs|fri|satur|sun)day|weekday|weekend)\b",
            re.I,
        ),
        "TIME — the query names a timeframe. Judge every fact against it: a "
        "fact whose own window has closed does not satisfy a question about "
        "now or about the future, no matter how well the words match.",
    ),
    (
        "PERSON",
        re.compile(
            # "who is" must be followed by a NAME, not a preposition or a state.
            # Without the stoplist "who is in San Francisco next week" read as a
            # lookup of a person called "in", and the PERSON instruction told the
            # filter to drop everyone who was not that person -- turning the best
            # kind of query this feature exists for into an empty result.
            r"^\s*(?:who is|who's|whos)\s+(?!in\b|at\b|on\b|near\b|around\b|from\b"
            r"|free\b|available\b|going\b|coming\b|up\b|down\b|the\b|a\b|an\b"
            r"|still\b|already\b|good\b|best\b|worth\b|based\b|working\b|visiting\b)"
            r"|^\s*(?:what do i know about|tell me about|remind me about"
            r"|what'?s? (?:up )?with|how do i know|catch me up on)\b",
            re.I,
        ),
        "PERSON — the query is about one named person, not a search across the "
        "network. Keep that person and anyone genuinely ambiguous with the name; "
        "drop everyone else even if their facts are topically similar.",
    ),
    (
        "FACT",
        re.compile(
            r"\b(?:what does|what do|where does|when did|when does|how old|what'?s (?:his|her|their)"
            r"|which company|what company|job|title|role|works? (?:at|for)|studied|school"
            r"|birthday|kids|married|partner)\b",
            re.I,
        ),
        "FACT — the query wants a specific stored detail. Prefer contacts who "
        "actually hold that detail over contacts who are merely topically "
        "adjacent; 'they might know' is not an answer to 'what is their title'.",
    ),
    (
        "INTRO",
        re.compile(
            r"\b(?:introduce|intro|connect (?:me|him|her|them)|put (?:me|them) in touch"
            r"|who should (?:meet|know)|warm intro|referral)\b",
            re.I,
        ),
        "INTRO — the query is about connecting two parties. Both sides matter: "
        "keep contacts who fit the need AND contacts positioned to make the "
        "introduction.",
    ),
    (
        "AFFINITY",
        re.compile(
            r"\b(?:like[sd]?|love[sd]?|enjoys?|into|interested in|hates?|dislikes?"
            r"|fan of|obsessed with|would (?:like|enjoy|want)|good (?:fit|match) for"
            r"|who'?d be up for|down for)\b",
            re.I,
        ),
        "AFFINITY — the query is about taste or interest. Adjacent interests "
        "count (the goal is time spent together, not a literal keyword match), "
        "but a stated dislike is evidence AGAINST, not for.",
    ),
]


def classify_query_facets(query: Optional[str]) -> List[str]:
    """The facet labels this query matches, in a stable order. May be empty."""
    if not query or not isinstance(query, str) or not query.strip():
        return []
    q = query.strip()
    return [label for label, pattern, _ in _FACETS if pattern.search(q)]


def facet_instructions(query: Optional[str]) -> Dict[str, str]:
    """{label: instruction} for the matched facets. Empty dict when none match."""
    labels = set(classify_query_facets(query))
    return {label: text for label, _, text in _FACETS if label in labels}


def facet_block(query: Optional[str]) -> str:
    """The prompt section, or '' when nothing matched.

    Returning '' rather than a "no facets detected" line matters: an empty string
    leaves the Stage-1 prompt byte-identical to what it was before this module
    existed, so an unmatched query provably cannot change behaviour.
    """
    instructions = facet_instructions(query)
    if not instructions:
        return ""
    labels = [label for label in classify_query_facets(query) if label in instructions]
    lines = [f"\nWhat this query is asking for: {', '.join(labels)}"]
    for label in labels:
        lines.append(f"- {instructions[label]}")
    return "\n".join(lines) + "\n"
