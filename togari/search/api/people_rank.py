"""PeopleRank — query-driven ranking over the caller's own contacts.

This is the surface the Amber iOS middle tab consumes. Where
`/v1/match/community-event` matches a curated event roster into mutual pairs,
this endpoint answers the simpler, search-style question the app asks:

    "Given everything I know about my network, who should I reach out to?"

It reuses the repo's own PeopleRank machinery:
  - `peoplerank.embeddings.OpenAIBackend` for semantic query->contact relevance
  - a light structured "proximity" signal (shared city / company with the caller)
  - the Anthropic rationale writer for a grounded, cited natural-language answer

The response shape is byte-for-byte what `apps/mobile/lib/peoplerank.ts`
already parses: `people[]` with score + components + reason, an `answer`
string carrying inline `[[p:CONTACT_ID]]` markers, and a `citations[]` array.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

# Make src/ importable (mirrors api/scoring.py)
_ROOT = Path(__file__).resolve().parent.parent
_SRC = str(_ROOT / "src")
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from . import persist_cache  # noqa: E402
from .schemas import ContactIn, FactIn, MeProfile, PeopleRankRequest  # noqa: E402
from .temporal import (  # noqa: E402
    age_in_days,
    describe_age,
    fact_time_note,
    staleness_multiplier,
)
from .query_facets import facet_block  # noqa: E402

# Embedding model: small is plenty for query<->contact relevance and far
# cheaper than 3-large when a user has hundreds of contacts.
_EMBED_MODEL = "text-embedding-3-small"
# Stage-3 grounded-answer model. Stays on the stronger model -- answer/rerank
# quality is user-facing prose. Env-overridable to bump in one place.
_ANSWER_MODEL = os.environ.get("PEOPLERANK_ANSWER_MODEL", "claude-sonnet-4-5")
# Stage-1 keep/drop model. Stage 1 is a lenient COARSE gate over the already-
# prefiltered (<=60) candidate set -- a keep-list decision, not prose -- so a
# fast model is appropriate and cuts its latency; Stage 3's answer deliberately
# stays on the stronger _ANSWER_MODEL. Env-overridable to A/B or revert instantly.
_STAGE1_MODEL = os.environ.get("PEOPLERANK_STAGE1_MODEL", "claude-haiku-4-5")
_ANSWER_TOP_N = 6

# How long to wait on the single grounded-answer Claude call before giving up
# and returning the ranked people without an answer. The ranking itself never
# depends on this call, so a slow model degrades to "people, no prose" instead
# of failing the request. Override with PEOPLERANK_ANSWER_TIMEOUT_S.
_ANSWER_TIMEOUT_S = float(os.environ.get("PEOPLERANK_ANSWER_TIMEOUT_S", "20"))

# Final-score blend when a query is present. Relevance (what you asked for)
# dominates, but a small proximity term breaks ties toward people the caller is
# actually close to, so two equally on-topic contacts rank the closer one
# first. With no query, proximity carries the whole signal. Tune via env without
# a redeploy: PEOPLERANK_W_RELEVANCE / PEOPLERANK_W_PROXIMITY (they are
# renormalized, so they need not sum to 1).
#
# NOTE: "proximity" is the structured city/field closeness-to-the-caller signal.
# The name "warmth" is intentionally reserved for a future real-closeness
# dimension (interaction / recency based) and is deliberately NOT used here.
_W_RELEVANCE = float(os.environ.get("PEOPLERANK_W_RELEVANCE", "0.85"))
# Read the new name, but fall back to the legacy PEOPLERANK_W_WARMTH so a value
# already set in the Railway environment keeps applying after the rename instead
# of silently reverting to the 0.15 default.
_W_PROXIMITY = float(
    os.environ.get("PEOPLERANK_W_PROXIMITY", os.environ.get("PEOPLERANK_W_WARMTH", "0.15"))
)

# Hard confidence floor. A contact with a query must clear this relevance
# score (and have at least one scoring unit -- an eligible fact, or notes/
# title/company/city to fall back on -- in the first place) to be returned
# at all — we never guess by ranking a no-signal contact to the bottom
# instead of dropping it. Override with PEOPLERANK_MIN_RELEVANCE.
PEOPLERANK_MIN_RELEVANCE = float(os.environ.get("PEOPLERANK_MIN_RELEVANCE", "0.15"))

# Stage-1 prefilter cap. When a query is present and there are MORE than this
# many contacts, a cheap coarse embedding-relevance pass ranks all contacts and
# only the top-K are handed to the expensive Stage-1 LLM keep/drop (the LLM over
# ~1k contacts is the dominant latency). Deliberately generous for high recall
# so a real match is never dropped before the LLM sees it. When contact_count
# <= K the prefilter is skipped and the path is identical to before. Override
# with PEOPLERANK_PREFILTER_K.
PEOPLERANK_PREFILTER_K = max(1, int(os.environ.get("PEOPLERANK_PREFILTER_K", "60")))

# Returned verbatim (no LLM call) when a query is present but zero contacts
# clear the relevance floor.
_NO_MATCHES_ANSWER = (
    "I don't have any notes on people in your network for that yet. "
    "Want to add some details to your contacts so I can find the right "
    "people next time?"
)


def _clamp01(v: float) -> float:
    if v < 0:
        return 0.0
    if v > 1:
        return 1.0
    return float(v)


def _relevance_fact_texts(c: ContactIn) -> List[str]:
    """Facts eligible to act as evidence: excludes "feeling" facts, which never
    drive ranked results or the grounded answer. Used by _generate_answer
    (the LLM prompt) and _drivers; _scoring_units applies the same "exclude
    feeling category" rule independently for Stage 2, since it needs the
    FactIn object alongside the text, not just the text."""
    return [
        f.text for f in (c.facts or [])
        if f.text and (f.category or "").strip().lower() != "feeling"
    ]


# ---------------------------------------------------------------------------
# Stage 1 — query-driven contact filter (runs BEFORE embedding relevance)
# ---------------------------------------------------------------------------
#
# A pure per-contact KEEP/DROP decision, for THIS specific query: judges each
# contact using its full payload (facts with their metadata, plus notes/title/
# company/city), resolving relative time/place references against the caller's
# current datetime and city. It never rewrites, aggregates, or strips anything
# about a kept contact -- a kept contact reaches Stage 2 with its original
# FactIn objects and structured fields completely untouched. The output is
# KEEP-ONLY (a list of contactIds); it deliberately emits no per-fact advisory
# notes -- that output was unused by scoring and its token cost dominated
# Stage-1 latency. FAILS OPEN on any error so a Stage 1 outage never blocks
# scoring.

_STAGE1_SYSTEM = (
    "You are a LENIENT first-pass filter, a bouncer, not the final judge. "
    "Your job is to keep every contact who has ANY plausible connection to "
    "the query, and drop only contacts with NO plausible connection at all. "
    "Later scoring stages handle fine ranking, ties, and who scores higher "
    "or lower, so err toward keeping. Do not try to rank or find a perfect "
    "match here."
    "\n\n"
    "You are given the user's query, the current datetime, the user's city "
    "and timezone, and a list of contacts. Each contact has: contactId, "
    "name, title, company, city, notes, and a list of facts. Each fact has "
    "text and category, plus optional metadata (sentiment, certainty, "
    "conditions, and whether it is past). Some contacts have no facts at "
    "all; judge those using their notes and structured fields."
    "\n\n"
    "Judge each contact using ALL of their information together: facts, "
    "notes, title, company, "
    "city. The current local date, day of week, and time are given to you "
    "explicitly in the prompt as a plain statement (for example 'Tuesday, "
    "July 7, 2026, 8:47 PM'). Treat that stated local date as ground truth "
    "and use the stated day directly to resolve relative references like "
    "'tonight', 'today', or 'this weekend'. Do NOT attempt to derive the "
    "day of week yourself from any ISO or UTC timestamp, that computation "
    "is unreliable, always defer to the stated local date instead. Resolve "
    "'my city' or 'near me' to the user's own city."
    "\n\n"
    "SHELF LIFE. Some facts stop being true on their own. A visit, a trip, a "
    "conference, a stay, 'in town for the week' -- each is true for a while and "
    "then simply is not, and nobody sends a correction when a trip ends. A move, "
    "a job, a city, a relationship, a trait, a preference has no such expiry and "
    "stays true until something contradicts it. When a fact was learned, you are "
    "told so in plain words ('learned: 5 weeks ago'), and when its own words "
    "describe something temporary that has plainly outlasted itself the fact is "
    "marked EXPIRED for you -- you do not need to compute any of this.\n"
    "Treat an EXPIRED fact as evidence of what someone DID, never of what is "
    "true now. It does not answer 'who is in Austin' or 'who is around this "
    "weekend'; it does answer 'who knows Austin' or 'who has been there'. If a "
    "contact's ONLY connection to the query is an expired temporary fact and the "
    "query is about the present or the future, drop them. If the query is about "
    "the past, history, or experience, keep them. An undated fact carries no "
    "such marking and must be judged on its words alone, exactly as before -- "
    "never assume a fact is stale because you were not told when it was learned."
    "\n\n"
    "KEEP, in particular:\n"
    "- Direct matches to the query's subject (a query about Mexican food, "
    "a contact whose facts mention Mexican food).\n"
    "- Adjacent or related signals, at a plausible but weaker level (a "
    "query about Mexican food, a contact with ANY food or shared-meal "
    "signal, such as liking another cuisine or disliking one, since they "
    "still plausibly share a meal). The underlying goal is spending time "
    "together and strengthening the relationship, not the literal detail, "
    "so related-domain contacts belong in the keep set.\n"
    "- A contact who conflicts on a CONDITION but still relates to the "
    "subject (for example 'likes Mexican food only on weekends' when today "
    "is a weekday): keep them. The wrong day is not a reason to drop, keep "
    "them so later stages can decide. They still relate to Mexican food.\n"
    "- A contact lifted by an explicit relevant signal actually present in "
    "their data (for example the user recently expressed wanting to spend "
    "more time with them, and is now making a plan): keep. Do not invent "
    "such a signal, only act on one that is actually present.\n"
    "\n"
    "DROP only:\n"
    "- Contacts with no plausible connection to the query's subject or "
    "intent at all (a query about Mexican food, a contact whose only data "
    "is 'training for a marathon', with nothing about food, meals, or a "
    "relevant social signal). No relation, no meal or social angle, no "
    "relevant signal, drop.\n"
    "- A contact with only a name and a phone number and nothing else, "
    "unless the query is specifically about that named person.\n"
    "\n"
    "Do NOT drop a contact merely because they are not a perfect match. "
    "Imperfect but plausibly related means KEEP. Only a genuine absence of "
    "connection means DROP. Never infer anything from a person's name, a "
    "name is an identifier only, never evidence. Keep it lenient but not "
    "indiscriminate: a contact must have a real, statable reason to be in "
    "the group. 'They have a food note so they might enjoy a meal' is a "
    "real reason. 'They exist' is not."
    "\n\n"
    "Return STRICT JSON and nothing else, no preamble, no code fences, no "
    "commentary, in exactly this shape:\n"
    '{"keep":["contactId", ...]}\n'
    "keep is the list of contactIds to keep, in any order. Include a "
    "contactId only if it was in the provided list, and omit every contact "
    "that is not relevant. Output nothing but this single JSON object -- do "
    "not add per-fact notes, signals, explanations, or any other keys."
)


def _me_facts_block(me: Optional[MeProfile], limit: int = 12) -> str:
    """Render the caller's own facts as a short text block for LLM context.
    Returns '' when there are none. Caps at `limit` facts to bound prompt size.
    Only text + category are surfaced (tags are for Stage-2 math, not the prompt)."""
    if me is None or not getattr(me, "facts", None):
        return ""
    lines = []
    for f in me.facts[:limit]:
        if not getattr(f, "text", None):
            continue
        cat = f" ({f.category})" if f.category else ""
        lines.append(f"- {f.text}{cat}")
    return "\n".join(lines)


def _stage1_fact_block(f: FactIn, now: Optional[str] = None) -> str:
    parts = [f"text: {f.text}"]
    if f.category:
        parts.append(f"category: {f.category}")
    if f.sentiment:
        parts.append(f"sentiment: {f.sentiment}")
    if f.sentiment_strength is not None:
        parts.append(f"sentiment_strength: {f.sentiment_strength}")
    if f.certainty is not None:
        parts.append(f"certainty: {f.certainty}")
    parts.append(f"is_conditional: {bool(f.is_conditional)}")
    if f.condition_text:
        parts.append(f"condition_text: {f.condition_text}")
    parts.append(f"is_past: {bool(f.is_past)}")
    # WHEN WE HEARD IT, in words. The system prompt tells the model not to do
    # date arithmetic on timestamps because it is unreliable; handing it a
    # computed phrase removes the arithmetic rather than asking for it again.
    # Rendered only when the sender supplied a date, so an undated fact's block
    # is byte-identical to before and cannot change a keep/drop decision.
    age = age_in_days(f.observed_at, now)
    if age is not None:
        parts.append(f"learned: {describe_age(age)}")
        note = fact_time_note(f.text, f.observed_at, now)
        if note:
            parts.append(note)
    return " | ".join(parts)


def _stage1_contact_block(c: ContactIn, now: Optional[str] = None) -> str:
    lines = [
        f"- contactId: {c.contactId}",
        f"  name: {c.name}",
        f"  title: {c.title or 'unknown'}",
        f"  company: {c.company or 'unknown'}",
        f"  city: {c.city or 'unknown'}",
        f"  notes: {c.notes or 'none'}",
    ]
    # Additive, rendered only when present so an empty industry/tags leaves the
    # block byte-identical to before (identical Stage-1 keep/drop behavior).
    if c.industry:
        lines.append(f"  industry: {c.industry}")
    if c.tags:
        lines.append(f"  tags: {', '.join(c.tags)}")
    facts = [f for f in (c.facts or []) if f.text]
    if facts:
        lines.append("  facts:")
        for f in facts:
            lines.append(f"    - {_stage1_fact_block(f, now)}")
    else:
        lines.append("  facts: none")
    return "\n".join(lines)


def stage1_filter(
    query: str,
    contacts: List[ContactIn],
    me: Optional[MeProfile],
    now: Optional[str],
    now_local: Optional[str] = None,
) -> Optional[Dict[str, object]]:
    """Query-driven Stage 1 KEEP-ONLY filter. One Claude call, temperature 0.

    Judges each contact -- using ALL of its information (facts with their
    metadata, plus notes/title/company/city) -- against the query's actual
    intent. Pure keep/drop: never rewrites, drops individual facts from, or
    reorders anything about a kept contact's payload. Every contact is sent to
    the model, including contacts with no facts at all -- those are judged on
    notes/structured fields alone and can still be kept.

    The model returns ONLY a keep list. The advisory per-fact notes it used to
    emit are gone: they cost a large amount of Stage-1 output tokens (the
    dominant latency) for output that scoring did not need. The return contract
    is preserved -- callers still receive a `notes` key -- but it is ALWAYS an
    empty dict now, so any downstream consumer (e.g. the Stage-2 time-condition
    multiplier) simply no-ops.

    Returns, on success:
        {
            "keep": set[str],   # contactIds to keep
            "notes": {},        # always empty; kept for caller compatibility
        }

    Returns None when there is nothing to filter (no query, no contacts, no
    API key) or when the call/parse fails for any reason (timeout, API
    error, malformed JSON) -- callers must treat None as FAIL OPEN: keep
    every contact, exactly as before Stage 1 existed. This function never
    raises.
    """
    if not query or not contacts:
        return None
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None

    contacts_block = "\n".join(_stage1_contact_block(c, now_local or now) for c in contacts)

    me_city = (me.city if me else None) or "unknown"
    me_tz = (me.timezone if me else None) or "unknown"
    me_facts_txt = _me_facts_block(me)
    me_facts_section = f"\nWhat we know about the user:\n{me_facts_txt}\n" if me_facts_txt else ""
    # WHAT KIND OF QUESTION THIS IS, named before the contacts are read.
    # Deterministic (cue words, no model call), and empty for a query that
    # matches nothing -- which leaves this prompt byte-identical to what it was
    # before facets existed. See api/query_facets.py.
    facets = facet_block(query)
    user_prompt = (
        f"Query: {query}\n"
        f"Current local date and time: {now_local or now or 'unknown'}\n"
        f"User's city: {me_city}\n"
        f"User's timezone: {me_tz}\n"
        f"{facets}"
        f"{me_facts_section}"
        f"\nContacts:\n{contacts_block}\n\n"
        "Return the JSON now."
    )

    try:
        from anthropic import Anthropic

        client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=_ANSWER_TIMEOUT_S)
        resp = client.messages.create(
            model=_STAGE1_MODEL,
            max_tokens=1024,  # keep-only ID list over the prefiltered <=60 is short
            temperature=0,
            system=[{"type": "text", "text": _STAGE1_SYSTEM}],
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(
            getattr(b, "text", "") for b in resp.content
            if getattr(b, "type", None) == "text"
        ).strip()
        # Defensive extraction: take the substring between the first '{' and
        # the last '}' so a stray preamble or code fence cannot break the
        # parse. Reuses the same "extract the JSON object, don't demand a
        # byte-perfect response" tolerance as the rest of this file's
        # LLM-parsing helpers.
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end < start:
            return None
        parsed = json.loads(text[start:end + 1])
        valid_ids = {c.contactId for c in contacts}
        keep = {
            cid for cid in parsed.get("keep", [])
            if isinstance(cid, str) and cid in valid_ids
        }
        # Keep-only: `notes` is intentionally always empty. The return contract
        # keeps the key so callers (and the Stage-2 time-condition multiplier)
        # stay untouched; with {} they simply no-op.
        return {"keep": keep, "notes": {}}
    except Exception:
        # Timeout, API error, malformed JSON -- fail open rather than ever
        # crashing the request or returning an empty result due to an error.
        return None


_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> set:
    return set(_TOKEN_RE.findall((text or "").lower()))


# ---------------------------------------------------------------------------
# Relevance: semantic (embeddings) -> semantic (TF-IDF) -> keyword overlap
# ---------------------------------------------------------------------------

# Reuse one OpenAI backend across requests so its in-memory embedding cache
# survives between calls. The backend already persists vectors to disk keyed by
# text content, so a contact embedded on one request is free on the next; the
# shared instance adds an in-process layer on top so warm contacts skip even
# the disk read. None until first successful construction (no key -> stays None).
_backend = None
_backend_failed = False


def _get_backend():
    """Return a cached OpenAIBackend, or None if it cannot be constructed."""
    global _backend, _backend_failed
    if _backend is not None:
        return _backend
    if _backend_failed:
        return None
    try:
        from peoplerank.embeddings import OpenAIBackend

        _backend = OpenAIBackend(model=_EMBED_MODEL)
        return _backend
    except Exception:
        # Missing key / package: remember the failure so we do not retry the
        # import on every contact lookup.
        _backend_failed = True
        return None


def _cosine_rows(qv: np.ndarray, rows: np.ndarray) -> Optional[List[float]]:
    q_norm = float(np.linalg.norm(qv))
    if q_norm == 0:
        return None
    out: List[float] = []
    for row in rows:
        c_norm = float(np.linalg.norm(row))
        if c_norm == 0:
            out.append(0.0)
            continue
        # Cosine lands in [-1,1]; clamp the negative tail to 0 so it reads as a
        # 0..1 relevance bar in the app.
        out.append(_clamp01(float(qv.dot(row)) / (q_norm * c_norm)))
    return out


def _embedding_relevance(query: str, docs: List[str]) -> Optional[List[float]]:
    """Cosine(query, contact) in [0,1] via OpenAI embeddings, or None on failure."""
    if not query or not docs:
        return None
    backend = _get_backend()
    if backend is None:
        return None
    try:
        matrix = backend.embed_batch([query] + docs)
    except Exception:
        return None
    if matrix.shape[0] != len(docs) + 1:
        return None
    return _cosine_rows(matrix[0], matrix[1:])


def _tfidf_relevance(query: str, docs: List[str]) -> Optional[List[float]]:
    """Local TF-IDF cosine relevance. Semantic-ish fallback when the embeddings
    API is down or unkeyed: it still captures term importance and rare-word
    weighting that raw Jaccard overlap misses, with no network call."""
    if not query or not docs:
        return None
    try:
        from peoplerank.embeddings import TFIDFBackend

        backend = TFIDFBackend()
        # Fit over the corpus (query + docs) so IDF reflects the contact set.
        matrix = backend.embed_batch([query] + docs)
    except Exception:
        return None
    if matrix.shape[0] != len(docs) + 1:
        return None
    return _cosine_rows(matrix[0], matrix[1:])


def _keyword_relevance(query: str, docs: List[str]) -> List[float]:
    """Jaccard-ish token overlap, the final fallback when both vector paths fail."""
    q_tokens = _tokens(query)
    if not q_tokens:
        return [0.0 for _ in docs]
    out: List[float] = []
    for doc in docs:
        d_tokens = _tokens(doc)
        if not d_tokens:
            out.append(0.0)
            continue
        overlap = len(q_tokens & d_tokens)
        out.append(_clamp01(overlap / len(q_tokens)))
    return out


def _relevance(query: str, docs: List[str]) -> List[float]:
    """Best available relevance signal: OpenAI embeddings, then local TF-IDF
    cosine, then keyword overlap. Always returns one score per doc."""
    return (
        _embedding_relevance(query, docs)
        or _tfidf_relevance(query, docs)
        or _keyword_relevance(query, docs)
    )


# ---------------------------------------------------------------------------
# Stage 2 relevance — per-fact, not one flattened contact doc
# ---------------------------------------------------------------------------
#
# Each contact's eligible facts are scored INDEPENDENTLY against the query,
# so the single best-matching fact drives the contact's score instead of
# being diluted into one blended cosine over every field at once. A contact
# with no eligible facts at all still gets one aggregate "profile" unit
# (notes/title/company/city) so fact-less-but-noted contacts are not
# wrongly starved of any score to be judged on.


def _scoring_units(c: ContactIn) -> List[Tuple[Optional[FactIn], str]]:
    """Per-contact scoring units for Stage 2: one per eligible fact (same
    "exclude feeling category" rule as _relevance_fact_texts, so the two
    stay in lockstep), plus one aggregate unit (fact=None) built from
    notes/title/company/city when any of those are present. A contact with
    neither yields an empty list -- nothing to score it on."""
    units: List[Tuple[Optional[FactIn], str]] = []
    for f in (c.facts or []):
        if f.text and (f.category or "").strip().lower() != "feeling":
            units.append((f, f.text))
    # industry + tags fold into the profile unit alongside notes/title/company/
    # city. Both are additive: a contact with no industry and no tags yields the
    # exact same profile_text as before, so relevance is unchanged.
    tags_text = " ".join(t for t in (c.tags or []) if t)
    profile_text = " ".join(
        x for x in [c.notes, c.title, c.company, c.city, c.industry, tags_text] if x
    ).strip()
    if profile_text:
        units.append((None, profile_text))
    return units


def _fact_relevance(
    query: str, contacts: List[ContactIn]
) -> Dict[str, List[Tuple[Optional[FactIn], float]]]:
    """Per-fact relevance: every scoring unit (facts + the profile fallback)
    across ALL contacts is embedded in ONE batched call via _relevance --
    the same embedding -> TF-IDF -> keyword fallback chain used everywhere
    else in this file, just run over a fact-level corpus instead of a
    contact-level one. Returns {contactId: [(FactIn_or_None, base_score), ...]}
    aligned 1:1 with that contact's _scoring_units() output. A contact with
    no units maps to an empty list.
    """
    units_by_contact: Dict[str, List[Tuple[Optional[FactIn], str]]] = {
        c.contactId: _scoring_units(c) for c in contacts
    }
    flat_texts: List[str] = []
    index_map: List[Tuple[str, int]] = []  # (contactId, position in that contact's units)
    for c in contacts:
        for i, (_, text) in enumerate(units_by_contact[c.contactId]):
            flat_texts.append(text)
            index_map.append((c.contactId, i))

    out: Dict[str, List[Tuple[Optional[FactIn], float]]] = {
        c.contactId: [(fact, 0.0) for fact, _ in units_by_contact[c.contactId]]
        for c in contacts
    }
    if not flat_texts:
        return out

    scores = _relevance(query, flat_texts)
    for (cid, pos), score in zip(index_map, scores):
        fact, _ = units_by_contact[cid][pos]
        out[cid][pos] = (fact, score)
    return out


# Sentiment direction cues used to infer whether the query is seeking
# positive or negative signal. Deliberately topic-agnostic (no "food",
# "sports", etc.) -- only the direction of intent. Most "who should I do X
# with" queries seek people who WANT X, so positive is the default; a query
# is only treated as negative-seeking if it contains an explicit
# negative-intent cue.
_NEGATIVE_INTENT_CUES = (
    "avoid", "hate", "hates", "dislike", "dislikes", "dread", "dreads",
    "never want", "don't want", "do not want", "bad experience",
    "worst", "complain", "annoy", "annoyed", "regret",
)

# Sentiment-weighting magnitudes. An opposing fact at full sentiment_strength
# is crushed to _SENTIMENT_OPPOSE_FACTOR of its base score; an aligned fact
# at full strength gets up to a _SENTIMENT_ALIGN_BONUS multiplier (capped by
# the _clamp01 applied after weighting, so it can never exceed 1.0 outright).
_SENTIMENT_OPPOSE_FACTOR = 0.15
_SENTIMENT_ALIGN_BONUS = 1.10

# Weight: a fact's own significance (0..1) nudges its relevance up or down modestly.
# weight=0.5 is neutral (1.0x). High weight (1.0) gives at most +_WEIGHT_INFLUENCE; low
# weight (0.0) subtracts at most _WEIGHT_INFLUENCE. Minor by design — never dominates
# semantic relevance. Missing weight => neutral (1.0x).
_WEIGHT_INFLUENCE = float(os.environ.get("PEOPLERANK_WEIGHT_INFLUENCE", "0.15"))

# Certainty: how sure the stated fact is (0..1). Low-certainty facts contribute a bit
# less; high-certainty are unchanged. Missing certainty => neutral (1.0x, treat as certain).
# Scales the fact DOWN by at most _CERTAINTY_INFLUENCE at certainty=0. Minor by design.
_CERTAINTY_INFLUENCE = float(os.environ.get("PEOPLERANK_CERTAINTY_INFLUENCE", "0.20"))

# Per-category relevance multipliers. "feeling" stays excluded upstream (unchanged).
# Durable/identifying categories get a slight boost; transient ones neutral. Tunable.
# Unknown/missing category => 1.0. All close to 1.0 — minor nudges only.
_CATEGORY_MULTIPLIERS = {
    "identity": float(os.environ.get("PEOPLERANK_CAT_IDENTITY", "1.10")),
    "personality": float(os.environ.get("PEOPLERANK_CAT_PERSONALITY", "1.05")),
    "who": float(os.environ.get("PEOPLERANK_CAT_WHO", "1.05")),
    "activity": float(os.environ.get("PEOPLERANK_CAT_ACTIVITY", "1.00")),
}


def _infer_query_sentiment(query: str) -> str:
    """"positive" or "negative": which sentiment direction the query is
    seeking, inferred from cue words only (never from any topic). Defaults
    to "positive" -- the common case ("who likes X", "who should I do X
    with") -- unless an explicit negative-intent cue is present."""
    q = (query or "").lower()
    if any(cue in q for cue in _NEGATIVE_INTENT_CUES):
        return "negative"
    return "positive"


def _sentiment_weight(fact: Optional[FactIn], query_intent: str) -> float:
    """Multiplier applied to a fact's base relevance score, from that FACT'S
    OWN sentiment fields only (this is the exhaustive per-fact pass -- it
    never reads stage1_notes, which only covers the subset of facts Stage 1
    chose to flag). A fact whose sentiment opposes the query's intent is
    pushed down hard, scaled by sentiment_strength (missing strength treated
    as full-strength, since under-penalizing an explicitly negative fact is
    the worse failure mode). Aligned sentiment gets a small boost, scaled the
    same way. Neutral sentiment, no stated sentiment, and the profile
    fallback unit (fact=None) are all unchanged (multiplier 1.0).

    Deliberately ignores is_conditional/condition_text/is_past -- tense and
    conditionality are handled entirely separately (see
    _time_condition_multiplier, applied later from stage1_notes) so a
    conditional negative fact is never penalized twice.
    """
    if fact is None or not fact.sentiment:
        return 1.0
    sentiment = fact.sentiment.strip().lower()
    if sentiment == "neutral":
        return 1.0
    strength = fact.sentiment_strength if fact.sentiment_strength is not None else 1.0
    strength = _clamp01(strength)

    opposes = (
        (query_intent == "positive" and sentiment == "negative")
        or (query_intent == "negative" and sentiment == "positive")
    )
    if opposes:
        return 1.0 - strength * (1.0 - _SENTIMENT_OPPOSE_FACTOR)

    aligns = (
        (query_intent == "positive" and sentiment == "positive")
        or (query_intent == "negative" and sentiment == "negative")
    )
    if aligns:
        return 1.0 + strength * (_SENTIMENT_ALIGN_BONUS - 1.0)

    return 1.0


def _fact_staleness(fact: Optional[FactIn], now: Optional[str]) -> float:
    """Shelf-life multiplier for one fact. 1.0 for the profile fallback unit and
    for every fact that does not describe something temporary, which is nearly
    all of them. The rule itself lives in api/temporal.py so Stage 1 (which is
    shown the same verdict in words) and Stage 2 cannot drift apart."""
    if fact is None:
        return 1.0
    return staleness_multiplier(fact.text, fact.observed_at, now)


def _weight_multiplier(fact: Optional[FactIn]) -> float:
    """Minor booster/detractor from a fact's own `weight` (significance, 0..1).
    0.5 => 1.0x (neutral). 1.0 => 1.0+_WEIGHT_INFLUENCE. 0.0 => 1.0-_WEIGHT_INFLUENCE.
    Missing weight => 1.0. Deliberately small so semantic relevance stays dominant."""
    if fact is None or fact.weight is None:
        return 1.0
    w = _clamp01(fact.weight)
    return 1.0 + (w - 0.5) * 2.0 * _WEIGHT_INFLUENCE


def _certainty_multiplier(fact: Optional[FactIn]) -> float:
    """Minor down-scaler for low-certainty facts. certainty=1.0 (or missing) => 1.0x.
    certainty=0.0 => 1.0-_CERTAINTY_INFLUENCE. Linear in between. Never boosts above 1.0 —
    a highly certain fact is 'normal', an uncertain one contributes slightly less."""
    if fact is None or fact.certainty is None:
        return 1.0
    c = _clamp01(fact.certainty)
    return 1.0 - (1.0 - c) * _CERTAINTY_INFLUENCE


def _category_multiplier(fact: Optional[FactIn]) -> float:
    """Minor per-category nudge. Missing/unknown category => 1.0. ('feeling' facts never
    reach here — excluded from scoring units upstream.)"""
    if fact is None or not fact.category:
        return 1.0
    return _CATEGORY_MULTIPLIERS.get(fact.category.strip().lower(), 1.0)


# Hybrid-max collapse tuning: a fact must clear _MULTI_FACT_BONUS_THRESHOLD
# (post-sentiment-weight) to count as "also relevant"; each qualifying extra
# fact contributes a small, primary-scaled bonus, and the total bonus is
# capped at _MULTI_FACT_BONUS_CAP so a pile of mediocre facts can never
# meaningfully overtake a genuinely stronger single match elsewhere.
_MULTI_FACT_BONUS_THRESHOLD = 0.35
_MULTI_FACT_BONUS_PER_FACT = 0.04
_MULTI_FACT_BONUS_CAP = 0.10


def _collapse_contact_relevance(weighted_scores: List[float]) -> float:
    """Hybrid max: the single best-matching fact (or profile unit) drives
    the score, with a small, capped, diminishing bonus for each additional
    fact that also clears a modest relevance bar. Best fact dominates; extra
    relevant facts only nudge the result up."""
    if not weighted_scores:
        return 0.0
    ordered = sorted(weighted_scores, reverse=True)
    primary = ordered[0]
    bonus = 0.0
    for s in ordered[1:]:
        if s < _MULTI_FACT_BONUS_THRESHOLD:
            continue
        bonus += _MULTI_FACT_BONUS_PER_FACT * (s / max(primary, 1e-6))
    bonus = min(bonus, _MULTI_FACT_BONUS_CAP)
    return _clamp01(primary + bonus)


# Time-condition penalty magnitudes, applied AFTER the eligibility floor (see
# run_people_rank). "conflict" is a real, visible penalty -- the contact
# still surfaces but ranks meaningfully lower (e.g. the "Mexican food only on
# weekends" contact for a weekday query). "partial" is a smaller penalty.
# "match" and "not_time_based"/absent are no-ops; a clean day-of-week match
# is not boosted further here (it already scored well on sentiment/semantic
# relevance) to keep this step a pure penalty mechanism, not a second boost
# path layered on top of Stage 3's sentiment weighting.
_TIME_CONDITION_PENALTY = {
    "conflict": 0.55,
    "partial": 0.85,
    "match": 1.0,
    "not_time_based": 1.0,
}


# ---------------------------------------------------------------------------
# Deterministic time-condition penalty (Stage-2 CPU, no LLM, no network).
#
# The wrong-day penalty used to rely on Stage 1 emitting per-fact `time_condition`
# notes; Stage 1 is now keep-only, so we recompute the same signal here directly
# from the structured FactIn fields (is_conditional / condition_text / is_past)
# plus the query and the caller's stated local datetime. Conservative by design:
# we only penalize on a CLEARLY detectable day/time conflict and default to 1.0
# (no penalty) whenever anything is ambiguous, so a real contact is never buried.
# ---------------------------------------------------------------------------

# Weekday tokens -> 0=Mon .. 6=Sun. Includes common abbreviations. Matched with
# word boundaries (+ optional plural) so "sun"/"sat"/"wed"/"fri" never fire on
# "sunny"/"satisfied"/"wedding"/"friend".
_DAY_TO_IDX = {
    "monday": 0, "mon": 0,
    "tuesday": 1, "tues": 1, "tue": 1,
    "wednesday": 2, "wed": 2,
    "thursday": 3, "thurs": 3, "thur": 3, "thu": 3,
    "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}
_WEEKEND = frozenset({5, 6})
_WEEKDAYS = frozenset({0, 1, 2, 3, 4})
_ALL_DAYS = frozenset({0, 1, 2, 3, 4, 5, 6})


def _named_days(text: str) -> set:
    """Set of weekday ints named anywhere in text (word-boundary, optional
    plural). Empty when none are found."""
    t = (text or "").lower()
    out: set = set()
    for token, idx in _DAY_TO_IDX.items():
        if re.search(rf"\b{token}s?\b", t):
            out.add(idx)
    return out


def _bucket_from_text(text: str) -> Optional[str]:
    """Time-of-day bucket named in text: 'morning' | 'afternoon' | 'evening'
    (evening covers evening/night/tonight), or None. Evening wins ties."""
    t = (text or "").lower()
    if re.search(r"\b(tonight|evening|evenings|night|nights)\b", t):
        return "evening"
    if re.search(r"\b(morning|mornings)\b", t):
        return "morning"
    if re.search(r"\b(afternoon|afternoons)\b", t):
        return "afternoon"
    return None


def _parse_time_window(text: str) -> Tuple[Optional[frozenset], Optional[str]]:
    """Parse a free-text day/time window into (day_set, bucket). day_set is a
    frozenset of 0..6 or None (no day constraint detected); bucket is a string
    or None. Handles the common patterns only; unrecognized text -> (None, None)
    meaning 'no detectable window'."""
    t = (text or "").lower()
    days: set = set()
    if re.search(r"\bevery ?day\b", t) or re.search(r"\bdaily\b", t):
        days |= set(_ALL_DAYS)
    if re.search(r"\bweekends?\b", t):
        days |= set(_WEEKEND)
    if re.search(r"\bweekdays?\b", t):
        days |= set(_WEEKDAYS)
    days |= _named_days(t)
    bucket = _bucket_from_text(t)
    return (frozenset(days) if days else None, bucket)


def _today_weekday(now_local: Optional[str]) -> Optional[int]:
    """0=Mon..6=Sun for the stated local date, or None if unparseable. Prefers a
    leading weekday word (medha-id sends 'Tuesday, July 7, 2026, 8:47 PM'); else
    tries to parse a 'Month D, YYYY' date. Never raises."""
    if not isinstance(now_local, str) or not now_local.strip():
        return None
    s = now_local.strip()
    m = re.match(r"\s*([A-Za-z]+)", s)
    if m:
        w = m.group(1).lower()
        if w in _DAY_TO_IDX:
            return _DAY_TO_IDX[w]
    try:
        from datetime import datetime
        m2 = re.search(r"([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})", s)
        if m2:
            dt = datetime.strptime(f"{m2.group(1)} {int(m2.group(2))} {m2.group(3)}", "%B %d %Y")
            return dt.weekday()
    except Exception:
        pass
    return None


def _resolve_query_timeframe(
    query: str, now_local: Optional[str]
) -> Optional[Tuple[Optional[frozenset], Optional[str]]]:
    """Resolve the query's intended day/time window using the query text and the
    stated local date. Returns (day_set, bucket) when the query carries a
    detectable timeframe, or None when it does not (a timeless query like 'who
    should I get dinner with' -> no penalty is ever applied). Today-relative
    tokens (tonight/today/this morning|afternoon|evening/tomorrow) require a
    resolvable now_local; if now_local can't be parsed, those return None."""
    q = (query or "").lower()
    today = _today_weekday(now_local)
    days: set = set()
    saw_day = False

    if re.search(r"\bweekends?\b", q):
        days |= set(_WEEKEND)
        saw_day = True
    if re.search(r"\bweekdays?\b", q):
        days |= set(_WEEKDAYS)
        saw_day = True
    named = _named_days(q)
    if named:
        days |= named
        saw_day = True
    if re.search(r"\btomorrow\b", q):
        saw_day = True
        if today is None:
            return None
        days.add((today + 1) % 7)
    if re.search(r"\btonight\b|\btoday\b|\bthis (morning|afternoon|evening)\b", q):
        saw_day = True
        if today is None:
            return None
        days.add(today)

    bucket = _bucket_from_text(q)
    if not saw_day and bucket is None:
        return None
    return (frozenset(days) if days else None, bucket)


def _compare_windows(
    q_days: Optional[frozenset], q_bucket: Optional[str],
    f_days: Optional[frozenset], f_bucket: Optional[str],
) -> float:
    """Compare the query timeframe to a fact's window and return the penalty
    multiplier. Day axis: query fully inside the fact's days -> match; empty
    intersection -> conflict; partial overlap -> partial. Time axis: both
    specified and different bucket -> conflict. Either side unspecified on an
    axis -> that axis does not create a conflict (conservative). Overall:
    any conflict -> conflict(0.55); else any partial -> partial(0.85); else
    match(1.0)."""
    day_axis = "match"
    if f_days is not None and q_days is not None:
        inter = q_days & f_days
        if not inter:
            day_axis = "conflict"
        elif q_days <= f_days:
            day_axis = "match"
        else:
            day_axis = "partial"

    bucket_axis = "match"
    if f_bucket is not None and q_bucket is not None and f_bucket != q_bucket:
        bucket_axis = "conflict"

    if day_axis == "conflict" or bucket_axis == "conflict":
        return _TIME_CONDITION_PENALTY["conflict"]
    if day_axis == "partial":
        return _TIME_CONDITION_PENALTY["partial"]
    return _TIME_CONDITION_PENALTY["match"]


def _time_condition_multiplier(
    c: ContactIn, query: str, now_local: Optional[str]
) -> float:
    """Worst (lowest) time-condition multiplier across the contact's conditional
    facts, computed deterministically from the structured fields. Returns 1.0
    (no penalty) when: the query has no detectable timeframe; the contact has no
    conditional fact with a detectable day/time window; or anything is ambiguous.
    Only genuine, detectable conflicts (e.g. a weekend-only fact for a weekday
    'tonight' query, or a morning-only fact for an evening query) are penalized.
    Never raises -- any failure yields 1.0."""
    try:
        qtf = _resolve_query_timeframe(query, now_local)
        if qtf is None:
            return 1.0
        q_days, q_bucket = qtf
        worst = 1.0
        for f in (c.facts or []):
            if not getattr(f, "is_conditional", False):
                continue
            # Prefer the structured condition_text; fall back to the fact text
            # if the condition field carries no detectable window.
            f_days, f_bucket = _parse_time_window(f.condition_text or "")
            if f_days is None and f_bucket is None:
                f_days, f_bucket = _parse_time_window(f.text or "")
            if f_days is None and f_bucket is None:
                continue
            worst = min(worst, _compare_windows(q_days, q_bucket, f_days, f_bucket))
        return worst
    except Exception:
        return 1.0


# ---------------------------------------------------------------------------
# Proximity: light structured closeness to the caller (no query needed)
# ---------------------------------------------------------------------------


# Weighted multi-signal structured prior. The two legacy signals (city, field)
# keep their 0.5 weight so an all-empty extended prior scores EXACTLY as before;
# the extended signals add on top and the sum is clamped to [0,1], leaving the
# _W_PROXIMITY (0.15) blend semantics untouched (proximity stays a 0..1 term).
_PROX_WEIGHTS = {
    "city": 0.5,       # legacy: same city, OR contact.city among me's lived-in cities
    "hometown": 0.25,  # small: contact.city == me.hometown
    "field": 0.5,      # legacy: me.occupation tokens overlap contact title/company
    "school": 0.5,     # me.schools tokens overlap contact profile text
    "employer": 0.5,   # me.employers tokens overlap contact company/title
}

# Generic institution/org tokens that carry no discriminating signal on their
# own. Used ONLY to gate the extended school/employer overlaps: those flags
# require at least one shared NON-stopword token, so "University of Texas" does
# not match a contact merely on "of" or "university". Deliberately NOT applied
# to the legacy city/field/occupation signals -- their behavior stays exact.
_PROX_STOPWORDS = frozenset({
    "of", "the", "and", "at", "for",
    "university", "college", "school", "institute",
    "inc", "llc", "ltd", "corp", "corporation", "company", "co",
    "group", "holdings",
})


def _prox_flags(me: Optional[MeProfile], c: ContactIn) -> Dict[str, bool]:
    """Single source of truth for the structured closeness signals between the
    caller and a contact. Returns one bool per signal. When me's extended fields
    (cities/hometown/schools/employers) are all empty, only the two legacy
    signals ("city" via me.city, "field" via me.occupation) can fire, so both
    _proximity and _proximity_signals reduce to exactly their pre-change
    behavior."""
    flags = {"city": False, "hometown": False, "field": False, "school": False, "employer": False}
    if me is None:
        return flags

    c_city = (c.city or "").strip().lower()
    if c_city:
        # Legacy same-city, OR contact's city among the places me has lived.
        if me.city and c_city == me.city.strip().lower():
            flags["city"] = True
        elif any(c_city == (x or "").strip().lower() for x in (me.cities or [])):
            flags["city"] = True
        # Hometown is a separate, smaller nudge.
        if me.hometown and c_city == me.hometown.strip().lower():
            flags["hometown"] = True

    # Legacy field overlap: me.occupation tokens vs contact title/company tokens.
    title_company_tokens = _tokens(" ".join(x for x in [c.title, c.company] if x))
    if me.occupation and (_tokens(me.occupation) & title_company_tokens):
        flags["field"] = True

    # Schools overlap the contact's broader profile text. Require at least one
    # shared NON-stopword token so a generic word like "of"/"university" alone
    # never fires the flag.
    if me.schools:
        school_tokens = _tokens(" ".join(me.schools))
        profile_tokens = _tokens(
            " ".join(x for x in [c.title, c.company, c.city, c.notes, c.industry] if x)
        )
        if (school_tokens & profile_tokens) - _PROX_STOPWORDS:
            flags["school"] = True

    # Employers overlap the contact's company/title. Same non-stopword guard so
    # "Acme Corp" does not match merely on "corp".
    if me.employers:
        emp_tokens = _tokens(" ".join(me.employers))
        if (emp_tokens & title_company_tokens) - _PROX_STOPWORDS:
            flags["employer"] = True

    return flags


def _proximity(me: Optional[MeProfile], c: ContactIn) -> float:
    """Weighted multi-signal 0..1 structured closeness to the caller. Reduces
    EXACTLY to the legacy 0.5*same_city + 0.5*field_overlap (clamped) when me's
    extended fields are empty, so an all-empty prior ranks identically to before."""
    if me is None:
        return 0.0
    flags = _prox_flags(me, c)
    score = sum(_PROX_WEIGHTS[k] for k, on in flags.items() if on)
    return _clamp01(score)


# ---------------------------------------------------------------------------
# Drivers / missing / reason (all deterministic, no LLM cost per-contact)
#
# These are response-only: they explain the ranking the scorer already produced
# (relevance + proximity blend) and prompt the user to enrich sparse contacts. They
# do NOT feed the score — the composite formula, weights, and the hardcoded
# centrality/recency are untouched.
# ---------------------------------------------------------------------------


# Retuned for the per-fact-max Stage 2 rebuild. The old thresholds (0.55 /
# 0.35) were calibrated against one flattened whole-contact-doc cosine, which
# runs lower and more compressed than a per-fact MAX: taking the single
# best-matching fact against a focused query tends to land meaningfully
# higher (and the sentiment-alignment bonus can push a genuinely aligned top
# fact up to ~1.0). Raised both bars accordingly so "Strong"/"Relevant"
# still mean something under the new distribution. These are reasoned
# starting points, not measured against real query data yet -- revisit once
# there's production score distribution to calibrate against.
_REL_STRONG_THRESHOLD = 0.65
_REL_RELEVANT_THRESHOLD = 0.45


def _proximity_signals(c: ContactIn, me: Optional[MeProfile]) -> Tuple[bool, bool]:
    """(same_city, shares_field): the two structured proximity signals to the
    caller, for the driver chips / composed reason copy. Derived from the same
    _prox_flags source of truth as _proximity so the chips can never drift from
    the score. Broadened: hometown counts toward "same city" and school/employer
    overlap counts toward "shares your field"; reduces to the exact legacy two
    booleans when me's extended fields are empty."""
    flags = _prox_flags(me, c)
    same_city = flags["city"] or flags["hometown"]
    shares_field = flags["field"] or flags["school"] or flags["employer"]
    return (same_city, shares_field)


def _drivers(
    c: ContactIn,
    rel: float,
    prox: float,
    me: Optional[MeProfile],
    has_query: bool,
) -> List[str]:
    """Short, honest phrases for what we actually know that contributed.
    Derived ONLY from existing fields + the proximity match — no new inputs, no
    invention. Empty list when nothing applies."""
    out: List[str] = []
    if has_query and rel >= _REL_STRONG_THRESHOLD:
        out.append("Strong text match to your search")
    elif has_query and rel >= _REL_RELEVANT_THRESHOLD:
        out.append("Relevant text match")
    if c.title:
        out.append(f"Title: {c.title}")
    if c.company:
        out.append(f"Works at {c.company}")
    if c.city:
        out.append(f"Based in {c.city}")
    if c.notes:
        out.append("Has notes you've added")
    if _relevance_fact_texts(c):
        out.append("Has facts recorded")
    same_city, shares_field = _proximity_signals(c, me)
    if same_city:
        out.append("Same city as you")
    if shares_field:
        out.append("Shares your field")
    return out


# High-value fields whose absence is worth prompting the user to fill, ordered
# by importance: notes first (the voice-note hook), then company, title, city.
def _missing(c: ContactIn) -> List[str]:
    """Which high-value fields are empty, as user-facing prompt labels."""
    out: List[str] = []
    if not c.notes:
        out.append("notes")
    if not c.company:
        out.append("company")
    if not c.title:
        out.append("title")
    if not c.city:
        out.append("location")
    return out


def _reason(
    c: ContactIn,
    rel: float,
    prox: float,
    me: Optional[MeProfile],
    has_query: bool,
    missing: List[str],
) -> str:
    """An honest, composed one-or-two-sentence 'why': what concrete signals
    drove the rank, plus a gentle nudge toward the single most useful field the
    user could add. No threshold-bucket hype."""
    same_city, shares_field = _proximity_signals(c, me)

    # Concrete, human-readable fragments first so the sentence leads with what
    # the user can actually see ("Matched on <title> and <city>"); the softer
    # text-match note comes last and only fills a slot if a concrete one is free.
    frags: List[str] = []
    if c.title:
        frags.append(c.title)
    if c.company:
        frags.append(f"work at {c.company}")
    if same_city:
        frags.append("being in your city")
    elif c.city:
        frags.append(c.city)
    if shares_field and not same_city:
        frags.append("sharing your field")
    if has_query and rel >= _REL_STRONG_THRESHOLD:
        frags.append("a strong text match to your search")
    elif has_query and rel >= _REL_RELEVANT_THRESHOLD:
        frags.append("a text match to your search")

    if frags:
        top = frags[:2]
        body = top[0] if len(top) == 1 else f"{top[0]} and {top[1]}"
        lead = f"Matched on {body}."
    elif not has_query and prox >= 0.5:
        lead = "Close to you in city or work."
    elif has_query:
        lead = "Only a weak text match to your search."
    else:
        lead = "In your synced network."

    if missing:
        return f"{lead} Add {missing[0]} to sharpen this."
    return lead


# ---------------------------------------------------------------------------
# Grounded answer (one Anthropic call over the top-N)
# ---------------------------------------------------------------------------


def _scrub(text: str) -> str:
    if not text:
        return text
    text = text.replace("“", '"').replace("”", '"')
    text = text.replace("‘", "'").replace("’", "'")
    text = text.replace("—", ", ").replace("–", ", ")
    return text.strip()


# The grounded answer call now does TRIPLE duty: one Claude call returns the
# prose blurb, a per-person grounded "why" for the top few, AND an explicit
# relevance ranking of the candidates. Each section is separated by its own
# delimiter line so we can split them apart deterministically. The ranking is
# what makes the whole response consistent: it reorders people[], and the blurb,
# citations, why, and scores all follow from that single judgment.
_WHY_DELIM = "WHY:"
_RANK_DELIM = "RANK:"
_WHY_TOP_N = 3

_ANSWER_SYSTEM = (
    "You are Amber, helping someone reason over the people in their own network. "
    "You are given the user's question and a SET of their contacts to rank, each "
    "with an exact citation marker and their known fields (title, company, city, "
    "notes, facts). Judge each contact's ACTUAL fit to the question by reasoning "
    "over those fields, not by any order they happen to be listed in. For example, "
    "'Harvard CS, engineer at Palantir in NYC' is a stronger match for 'tech "
    "people in NYC' than 'attended a tech meetup once'. "
    "\n\n"
    "Base every recommendation ONLY on the facts, notes, and structured fields "
    "provided for each contact. Never infer interests, ethnicity, or any other "
    "trait from a person's name. A name is an identifier only, never evidence. "
    "If a contact has no fact, note, or field that genuinely matches the "
    "question, do not mention that contact in the recommendation or WHY "
    "sections. If none of the candidates genuinely match, say so plainly "
    "instead of forcing a recommendation. Never introduce a person who is not "
    "in the candidate list provided below."
    "\n\n"
    "Output THREE sections in this exact order:\n"
    "1) A 2 to 3 sentence recommendation of who to reach out to and why. Reference "
    "each person you name with their exact [[p:CONTACT_ID]] marker placed "
    "immediately after their name. Name people in the SAME ORDER as your ranking "
    "in section 3 (most relevant first). Only mention people from the provided "
    "list, and only when they genuinely match. Be specific and warm, never generic.\n"
    "2) A line containing only the token WHY: by itself, then exactly one line for "
    "each of the TOP 3 contacts in your ranking, in that order, each formatted as:\n"
    "[[p:CONTACT_ID]] <one honest sentence about what specifically matched>\n"
    "Each WHY sentence must be grounded ONLY in that contact's provided facts, "
    "notes, or fields, and the question. Be specific: say what the facts, notes, "
    "title, company, or city actually state (for example, 'Your notes say they "
    "are in finance at Chase in LA'), never vague phrases like 'matched on "
    "notes'. Be honest about weak matches: if someone only loosely fits (wrong "
    "city, tangential role), say so plainly (for example, 'Works in finance but "
    "as a valet, and based in Santa Barbara, so a looser fit for LA'). If a "
    "contact has almost no data (only a name and phone), say that honestly (for "
    "example, 'Only a name and number on file, so this is a weak text match').\n"
    "3) A line containing only the token RANK: by itself, then every candidate's "
    "[[p:CONTACT_ID]] marker on its own line, ordered from MOST to LEAST relevant "
    "to the question based on your reasoning over their facts and fields. "
    "Include every candidate from the list exactly once and no others; if you "
    "cannot judge some, list them last. Output nothing after the final RANK "
    "line.\n"
    "\n"
    "The current local date and day of week, when known, are provided in "
    "the prompt as a plain statement. Treat that statement as ground "
    "truth. When the question refers to 'tonight', 'today', or another "
    "relative day, use the stated current day directly. NEVER hedge or "
    "write conditional phrasing like 'if tonight is Monday' or 'assuming "
    "today is a weekday', you know what day it is from the stated date, so "
    "state the actual recommendation for today directly. Do not compute "
    "the day of week from any timestamp yourself."
    "\n\n"
    "Do not use em dashes. Do not use emojis."
)


def _build_answer_prompt(
    query: str,
    ranked: List[Tuple[ContactIn, float]],
    now_local: Optional[str] = None,
    me: Optional[MeProfile] = None,
) -> Tuple[Optional[str], str, set, List[Tuple[ContactIn, float]]]:
    """Return (user_prompt, skip_status, candidate_ids, top).

    Single source of truth for the Stage-3 prompt, shared by the blocking and
    streaming callers so both send byte-identical requests to the same model.
    `user_prompt` is None when there is nothing to ask (skip_status then holds
    the status the caller should surface: "skipped" / "no_key")."""
    if not query:
        return None, "skipped", set(), []
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None, "no_key", set(), []
    top = ranked[:_ANSWER_TOP_N]
    if not top:
        return None, "skipped", set(), []
    candidate_ids = {c.contactId for c, _ in top}
    lines = []
    for c, _ in top:
        note = (c.notes or "").strip()
        if len(note) > 200:
            note = note[:200].rstrip() + "…"
        facts_str = "; ".join(_relevance_fact_texts(c))
        line = (
            f"- {c.name} [[p:{c.contactId}]]"
            f" | title: {c.title or '—'}"
            f" | company: {c.company or '—'}"
            f" | city: {c.city or '—'}"
            f" | notes: {note or '—'}"
            f" | facts: {facts_str or '—'}"
        )
        # Additive, appended only when present so an empty industry/tags leaves
        # the candidate line byte-identical to before.
        if c.industry:
            line += f" | industry: {c.industry}"
        if c.tags:
            line += f" | tags: {', '.join(c.tags)}"
        lines.append(line)
    people_block = "\n".join(lines)
    # The candidate set is presented UNORDERED on purpose: the model must rank by
    # genuine fit to the query, not echo a pre-given order.
    date_line = f"Current local date and time: {now_local}\n\n" if now_local else ""
    me_facts_txt = _me_facts_block(me)
    me_section = f"About the person asking:\n{me_facts_txt}\n\n" if me_facts_txt else ""
    user_prompt = (
        f"Question: {query}\n\n"
        f"{date_line}"
        f"{me_section}"
        f"Candidate contacts to rank:\n{people_block}\n\n"
        "Write the recommendation, then the WHY: block, then the RANK: block."
    )
    return user_prompt, "ok", candidate_ids, top


def _answer_client():
    """Anthropic client for Stage 3.

    Per-request timeout so a slow model does not hold the whole rank response
    hostage. On timeout the SDK raises and the caller falls through to returning
    the ranked people with answer_status "timeout"."""
    from anthropic import Anthropic

    return Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=_ANSWER_TIMEOUT_S)


def _parse_answer_text(
    text: str,
    candidate_ids: set,
    top: List[Tuple[ContactIn, float]],
) -> Tuple[Optional[str], str, Dict[str, str], List[str]]:
    """Split one raw Stage-3 completion into (answer, status, why_map, rank_order).

    Shared by the blocking and streaming callers so both derive citations, why
    lines, and the rerank from the model text in exactly the same way."""
    text = _scrub(text)
    # Split the three sections on their delimiters: blurb | WHY block | RANK
    # block. Citations are parsed from the blurb only (the part before WHY:),
    # so WHY/RANK markers never leak into the citation list.
    blurb, _, rest = text.partition(_WHY_DELIM)
    why_section, _, rank_section = rest.partition(_RANK_DELIM)
    blurb = blurb.strip()
    # The model's explicit ranking is the single judgment everything follows.
    rank_order = _parse_rank_block(rank_section, candidate_ids)
    # WHY covers the top _WHY_TOP_N of the model's ranking when we have one;
    # otherwise fall back to the first _WHY_TOP_N candidates as given.
    if rank_order:
        why_ids = set(rank_order[:_WHY_TOP_N])
    else:
        why_ids = {c.contactId for c, _ in top[:_WHY_TOP_N]}
    why_map = _parse_why_block(why_section, why_ids)
    return (blurb or None), ("ok" if blurb else "error"), why_map, rank_order


def _generate_answer(
    query: str,
    ranked: List[Tuple[ContactIn, float]],
    now_local: Optional[str] = None,
    me: Optional[MeProfile] = None,
) -> Tuple[Optional[str], str, Dict[str, str], List[str]]:
    """Return (answer, answer_status, why_map, rank_order).

    One Claude call returns all three downstream signals: `answer` is the prose
    blurb (used for citations); `why_map` maps contactId -> a grounded one-line
    "why" for the top _WHY_TOP_N of the model's OWN ranking; `rank_order` is the
    model's explicit relevance ranking of the candidates (contactIds, most
    relevant first). Status mirrors the app's expectations. why_map is {} and
    rank_order is [] on any non-ok path (no key / timeout / error / parse miss),
    so callers fall back to the embedding order and the _reason template."""
    user_prompt, skip_status, candidate_ids, top = _build_answer_prompt(
        query, ranked, now_local, me
    )
    if user_prompt is None:
        return None, skip_status, {}, []
    try:
        resp = _answer_client().messages.create(
            model=_ANSWER_MODEL,
            max_tokens=800,  # blurb + up to 3 why-lines + one RANK line per candidate
            temperature=0.6,
            system=[{"type": "text", "text": _ANSWER_SYSTEM}],
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(
            getattr(b, "text", "") for b in resp.content
            if getattr(b, "type", None) == "text"
        )
        return _parse_answer_text(text, candidate_ids, top)
    except Exception as e:
        # Distinguish a timeout (slow, transient) from other failures so the
        # client can show "still ranking" copy rather than a hard error.
        status = "timeout" if _is_timeout(e) else "error"
        return None, status, {}, []


def _scrub_chunk(text: str) -> str:
    """_scrub's character substitutions without the whole-string strip.

    Safe to apply per streamed delta: every substitution is a single-character
    replacement, so chunking can never split one. The accumulated raw text is
    still run through the full _scrub before parsing, so the final `answer`
    field is identical to the non-streaming path."""
    if not text:
        return text
    text = text.replace("“", '"').replace("”", '"')
    text = text.replace("‘", "'").replace("’", "'")
    return text.replace("—", ", ").replace("–", ", ")


def _generate_answer_stream(
    query: str,
    ranked: List[Tuple[ContactIn, float]],
    now_local: Optional[str] = None,
    me: Optional[MeProfile] = None,
):
    """Same Stage-3 call as _generate_answer, streamed.

    Yields ("token", text) for each delta of the user-facing blurb, then exactly
    one ("result", (answer, answer_status, why_map, rank_order)) — the same
    4-tuple _generate_answer returns, parsed from the same accumulated text.

    Only the blurb is emitted as tokens: generation continues past the WHY: /
    RANK: delimiters (they carry the rerank and the grounded why lines) but
    those sections are never user-facing prose, so token emission stops at the
    first WHY:. Emission holds back the last few characters until the delimiter
    can be ruled out, so a delimiter split across two deltas is never leaked."""
    user_prompt, skip_status, candidate_ids, top = _build_answer_prompt(
        query, ranked, now_local, me
    )
    if user_prompt is None:
        yield "result", (None, skip_status, {}, [])
        return

    raw: List[str] = []
    emitted = 0          # chars of the visible blurb already yielded
    started = False      # have we yielded any non-whitespace yet (leading strip)
    hold = len(_WHY_DELIM) - 1  # never emit a possible partial "WHY:" prefix

    try:
        with _answer_client().messages.stream(
            model=_ANSWER_MODEL,
            max_tokens=800,  # blurb + up to 3 why-lines + one RANK line per candidate
            temperature=0.6,
            system=[{"type": "text", "text": _ANSWER_SYSTEM}],
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            for delta in stream.text_stream:
                raw.append(delta)
                full = "".join(raw)
                visible, found, _ = full.partition(_WHY_DELIM)
                # Hold back a possible partial delimiter until it is ruled out;
                # once WHY: has actually appeared the blurb is final and the
                # held-back tail is safe to flush. Trailing whitespace is always
                # held (it is either mid-prose, and more text follows, or it is
                # the run-up to WHY: and _scrub would have stripped it) so the
                # concatenated tokens equal the final `answer` exactly.
                end = len(visible) if found else max(0, len(visible) - hold)
                # rstrip the candidate region, not all of `visible`: the held
                # back tail may itself start with a non-whitespace partial
                # delimiter ("...first.\n\nWH"), which would hide the newlines.
                end = len(visible[:end].rstrip())
                if end > emitted:
                    chunk = _scrub_chunk(visible[emitted:end])
                    emitted = end
                    if not started:
                        chunk = chunk.lstrip()
                    if chunk:
                        started = True
                        yield "token", chunk
                # Keep consuming after the delimiter (WHY:/RANK: still needed
                # for the rerank and why lines) but emit nothing more.
        text = "".join(raw)
        # Flush a visible tail still held back because WHY: never arrived (for
        # example a completion truncated at max_tokens).
        visible = text.partition(_WHY_DELIM)[0].rstrip()
        if len(visible) > emitted:
            chunk = _scrub_chunk(visible[emitted:])
            chunk = chunk.lstrip() if not started else chunk
            if chunk:
                yield "token", chunk
        yield "result", _parse_answer_text(text, candidate_ids, top)
    except Exception as e:
        status = "timeout" if _is_timeout(e) else "error"
        yield "result", (None, status, {}, [])


def _parse_why_block(why_section: str, valid_ids: set) -> Dict[str, str]:
    """Parse the WHY: section into {contactId: why_sentence}.

    Each line is expected as '[[p:ID]] <sentence>'. Lines without a leading
    marker, with an unknown id, or with no sentence are skipped. Returns {} if
    nothing parses, so the caller cleanly falls back to the _reason template."""
    out: Dict[str, str] = {}
    if not why_section:
        return out
    for raw in why_section.splitlines():
        line = raw.strip()
        if not line:
            continue
        m = _MARKER_RE.match(line)
        if not m:
            continue
        cid = m.group(1).strip()
        why = line[m.end():].lstrip(" :-").strip()
        if cid in valid_ids and why and cid not in out:
            out[cid] = why
    return out


def _parse_rank_block(rank_section: str, valid_ids: set) -> List[str]:
    """Parse the RANK: section into an ordered list of contactIds (most relevant
    first). One [[p:ID]] marker per line. Keeps only ids that were in the
    candidate set, dedups, and preserves the model's order. Returns [] if nothing
    parses so the caller falls back to the embedding order."""
    out: List[str] = []
    if not rank_section:
        return out
    seen: set = set()
    for raw in rank_section.splitlines():
        line = raw.strip()
        if not line:
            continue
        m = _MARKER_RE.match(line)
        if not m:
            continue
        cid = m.group(1).strip()
        if cid in valid_ids and cid not in seen:
            out.append(cid)
            seen.add(cid)
    return out


def _is_timeout(err: Exception) -> bool:
    name = type(err).__name__.lower()
    if "timeout" in name:
        return True
    return "timed out" in str(err).lower()


_MARKER_RE = re.compile(r"\[\[p:([^\]]+)\]\]")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


class _RankCore:
    """Everything Stages 1+2 produce, handed to _finalize_rank once Stage 3 has
    run (or been skipped). `early` short-circuits: when it is not None it is a
    complete response and no other field is meaningful."""

    __slots__ = (
        "early", "query", "has_query", "scored", "ranked_for_answer",
        "answer_candidate_ids", "by_id", "timings_on", "t_total", "timing_parts",
    )

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))


def _rank_core(req: PeopleRankRequest) -> _RankCore:
    """Run the prefilter, Stage 1 and Stage 2 — everything up to (but not
    including) the Stage-3 answer call.

    This is the one implementation of the ranking pipeline; both
    /v1/me/people-rank and its streaming sibling call it, so there is no second
    copy of the prefilter/keep-drop/scoring logic to drift."""
    # Per-stage wall-clock timing (monotonic). Always measured -- perf_counter
    # is free -- but only ATTACHED to the response as `timings_ms` when
    # PEOPLERANK_TIMINGS=1, so the default response shape is byte-identical to
    # before (no behavior change, no test-shape regression). Read the flag per
    # call so it can be toggled at runtime / in tests.
    _timings_on = os.environ.get("PEOPLERANK_TIMINGS") == "1"
    _t_total = time.perf_counter()
    _stage1_ms = 0.0
    _stage2_ms = 0.0

    contacts = req.contacts or []
    query = (req.query or "").strip()
    has_query = bool(query)
    limit = max(1, min(req.limit or 15, 50))

    # contact_count is the ORIGINAL request size. stage1_contacts_in is what
    # Stage 1's LLM actually sees (== contact_count unless the prefilter below
    # trimmed it), and stage2_contacts_in (set after the filter) shows how many
    # survived Stage 1 into Stage 2's detailed scoring.
    contact_count = len(contacts)
    _prefilter_ms = 0.0
    prefiltered_from = None  # set to the pre-trim count only when the prefilter fires

    def _timing_parts() -> Dict[str, object]:
        # Everything known by the end of Stage 2, in the response's key order.
        # stage3_answer and total are placeholders overwritten in place by
        # _finalize_rank, the only place that knows both.
        return {
            "stage1": round(_stage1_ms, 2),
            "stage2_embed": round(_stage2_ms, 2),
            "stage3_answer": 0.0,
            "prefilter_ms": round(_prefilter_ms, 2),
            "total": 0.0,
            "contact_count": contact_count,
            "prefiltered_from": prefiltered_from,
            "stage1_contacts_in": stage1_contacts_in,
            "stage2_contacts_in": stage2_contacts_in,
        }

    # Prefilter — cheap coarse relevance gate BEFORE the Stage-1 LLM. The Stage-1
    # keep/drop LLM over ~1k contacts is the dominant latency, so when a query is
    # present and there are more than K contacts we first score ALL of them with
    # the same embedding-relevance machinery Stage 2 uses (facts + profile-text
    # unit vs the query), rank by that coarse per-contact score, and keep only
    # the top-K for the LLM. This is a REORDER/PRUNE of candidates, not a scoring
    # change: the surviving contacts flow through the unchanged Stage-1 / Stage-2
    # / Stage-3 exactly as before. `fact_scores_all` is the embedding result; it
    # is passed straight into Stage 2 so each contact is embedded at most once
    # per request. Skipped entirely (fact_scores_all stays None) when there is no
    # query or contact_count <= K, making those paths identical to before.
    fact_scores_all = None
    if has_query and contact_count > PEOPLERANK_PREFILTER_K:
        _t_pf = time.perf_counter()
        fact_scores_all = _fact_relevance(query, contacts)
        coarse: List[Tuple[ContactIn, float]] = []
        for c in contacts:
            base_scores = [b for (_f, b) in fact_scores_all.get(c.contactId, [])]
            coarse.append((c, _collapse_contact_relevance(base_scores)))
        # Highest coarse relevance first; stable name tie-break (mirrors the
        # deterministic ordering used elsewhere) so the kept set is reproducible.
        coarse.sort(key=lambda t: (-t[1], (t[0].name or "").lower()))
        prefiltered_from = contact_count
        contacts = [c for c, _ in coarse[:PEOPLERANK_PREFILTER_K]]
        _prefilter_ms = (time.perf_counter() - _t_pf) * 1000.0

    # What the Stage-1 LLM actually receives (post-prefilter). Equals
    # contact_count when the prefilter did not fire.
    stage1_contacts_in = len(contacts)

    # Stage 1 — query-driven contact filter, before embedding relevance. Only
    # runs when there is a query (there is no "intent" to filter against
    # otherwise, and the no-query path is proximity-only). stage1_filter
    # returns None on anything from "nothing to filter" to a genuine API
    # failure -- that is FAIL OPEN, meaning `contacts` is left exactly as
    # passed in (and stage1_notes stays empty), matching pre-Stage-1
    # behavior byte for byte. A kept contact is the SAME ContactIn object
    # from `contacts` -- its facts and every other field are untouched.
    #
    # stage1_notes is advisory per-fact metadata (time_condition,
    # sentiment_alignment, tense) keyed by contactId. It is captured here for
    # a future Stage 2 to consume -- nothing below this block reads it yet;
    # scoring, the blend, and the response shape are unaffected.
    stage1_notes: Dict[str, List[Dict[str, object]]] = {}
    _t_s1 = time.perf_counter()
    if has_query:
        stage1_result = stage1_filter(query, contacts, req.me, req.now, req.now_local)
        if stage1_result is not None:
            keep_ids = stage1_result["keep"]
            stage1_notes = stage1_result["notes"]
            contacts = [c for c in contacts if c.contactId in keep_ids]
            # Temporary diagnostic: which contacts survived Stage 1, and
            # what advisory notes came with them, before Stage 2 scoring
            # runs on them.
            print("PR_STAGE1_DEBUG", json.dumps({
                "query": query,
                "kept": [c.name for c in contacts],
                "notes": stage1_notes,
            }))
    _stage1_ms = (time.perf_counter() - _t_s1) * 1000.0
    # Survivors of Stage 1 == the set Stage 2 actually embeds/scores. With no
    # query (Stage 1 skipped) or Stage 1 failing open, this equals the input.
    stage2_contacts_in = len(contacts)

    # Stage 2 relevance — per-fact, not one flattened doc. Each contact's
    # eligible facts (plus the profile fallback unit) are scored
    # independently; each fact's base score is then sentiment-weighted
    # (exhaustive, from that fact's OWN sentiment fields against the query's
    # inferred intent -- this is separate from, and runs before, the
    # stage1_notes-driven time-condition penalty below) and the per-contact
    # scores collapse via hybrid max (best fact dominates; extra relevant
    # facts only nudge the result up, see _collapse_contact_relevance).
    _t_s2 = time.perf_counter()
    if has_query:
        query_intent = _infer_query_sentiment(query)
        # Reuse the prefilter's embedding result when it ran (each contact is
        # embedded at most once per request); otherwise compute now over the
        # current contact set, identical to before. Stage 2 only ever looks up
        # by contactId via .get(), so extra keys from dropped contacts are inert.
        fact_scores = fact_scores_all if fact_scores_all is not None else _fact_relevance(query, contacts)
        raw_relevance: List[float] = []
        has_scoring_unit: List[bool] = []
        for c in contacts:
            pairs = fact_scores.get(c.contactId, [])
            has_scoring_unit.append(bool(pairs))
            weighted = [
                _clamp01(
                    base
                    * _sentiment_weight(fact, query_intent)
                    * _weight_multiplier(fact)
                    * _certainty_multiplier(fact)
                    * _category_multiplier(fact)
                    # Shelf life. The same parser Stage 1 was shown in words, so
                    # the filter and the scorer cannot disagree about whether a
                    # trip is over. 1.0 for every fact that is not both
                    # self-describedly temporary AND past its window, which is
                    # nearly all of them. See api/temporal.py.
                    * _fact_staleness(fact, req.now_local or req.now)
                )
                for fact, base in pairs
            ]
            raw_relevance.append(_collapse_contact_relevance(weighted))
    else:
        raw_relevance = [0.0 for _ in contacts]
        has_scoring_unit = [True for _ in contacts]  # unused when has_query is False

    # Hard confidence floor: with a query, a contact must have at least one
    # scoring unit (an eligible fact, or notes/title/company/city to fall
    # back on) AND clear PEOPLERANK_MIN_RELEVANCE on that PRE-time-penalty
    # collapsed relevance to be eligible. A contact with nothing at all to
    # score is dropped outright rather than ranked to the bottom — there is
    # nothing to have matched the query against. Sentiment-based sinking
    # already happened above (a fact whose sentiment opposes the query is
    # already suppressed in raw_relevance), so a strongly opposing fact can
    # genuinely fail the floor here; a merely time-mismatched one has not
    # been penalized yet and still clears it, to be handled below. With no
    # query, proximity carries the whole signal and no floor applies.
    if has_query:
        eligible = [
            (c, rel) for c, rel, has_unit in zip(contacts, raw_relevance, has_scoring_unit)
            if has_unit and rel >= PEOPLERANK_MIN_RELEVANCE
        ]
    else:
        eligible = list(zip(contacts, raw_relevance))

    if has_query and not eligible:
        _stage2_ms = (time.perf_counter() - _t_s2) * 1000.0
        resp = {
            "query": query or None,
            "count": 0,
            "people": [],
            "answer": _NO_MATCHES_ANSWER,
            "answer_status": "no_matches",
            "citations": [],
        }
        if _timings_on:
            parts = _timing_parts()
            parts["total"] = round((time.perf_counter() - _t_total) * 1000.0, 2)
            resp["timings_ms"] = parts
        return _RankCore(early=resp)

    contacts = [c for c, _ in eligible]
    raw_relevance = [rel for _, rel in eligible]

    # Time-condition penalty — applied AFTER the floor. Computed deterministically
    # in Stage 2 from each contact's structured fact fields (is_conditional /
    # condition_text / is_past) versus the query's timeframe resolved against
    # now_local. A "conflict" lowers rank, it never drops a contact that already
    # cleared the floor (e.g. "likes Mexican food only on weekends" for a weekday
    # 'tonight' query still surfaces, just ranked lower). Conservative: 1.0 (no
    # penalty) for timeless queries, non-conditional facts, or anything ambiguous.
    relevance: List[float]
    if has_query:
        relevance = [
            _clamp01(raw * _time_condition_multiplier(c, query, req.now_local))
            for c, raw in zip(contacts, raw_relevance)
        ]
    else:
        relevance = raw_relevance

    # Temporary diagnostic: what cleared the eligibility filter, and the raw
    # (pre-time-penalty) vs. final (post-time-penalty) relevance for each.
    print("PR_ELIGIBLE_DEBUG", json.dumps({
        "query": query,
        "eligible": [
            {"name": c.name, "raw_relevance": round(raw, 3), "relevance": round(rel, 3)}
            for c, raw, rel in zip(contacts, raw_relevance, relevance)
        ],
    }))

    by_id: Dict[str, ContactIn] = {c.contactId: c for c in contacts}
    proximity = [_proximity(req.me, c) for c in contacts]

    # Final ranking signal. With a query: a renormalized blend of relevance
    # (dominant) and proximity (tie-breaker toward close contacts). With no query:
    # proximity carries the whole signal. See _W_RELEVANCE / _W_PROXIMITY.
    w_rel, w_prox = _W_RELEVANCE, _W_PROXIMITY
    w_total = w_rel + w_prox
    if w_total <= 0:
        w_rel, w_prox, w_total = 1.0, 0.0, 1.0

    scored: List[Tuple[ContactIn, float, float, float]] = []
    for c, rel, prox in zip(contacts, relevance, proximity):
        rel_c = _clamp01(rel)
        prox_c = _clamp01(prox)
        final = (w_rel * rel_c + w_prox * prox_c) / w_total if has_query else prox_c
        scored.append((c, _clamp01(final), rel_c, prox_c))

    # Deterministic fallback ordering: when the primary signal ties (e.g. a
    # cold-start network with no query and no proximity, or an all-zero relevance
    # row when every vector path failed), break ties by proximity then name so the
    # list is stable and meaningful instead of arbitrary input order.
    scored.sort(key=lambda t: (-t[1], -t[3], (t[0].name or "").lower()))
    scored = scored[:limit]
    # Stage 2 spans embedding relevance + sentiment/weight/certainty/category
    # weighting + floor + time-penalty + proximity blend + sort. The dominant
    # cost is the embedding call inside _fact_relevance.
    _stage2_ms = (time.perf_counter() - _t_s2) * 1000.0

    ranked_for_answer = [(c, final) for (c, final, _, _) in scored]
    # Mirrors _generate_answer's own top-N slice: the exact set of contactIds
    # shown to the LLM. RANK/WHY are already gated to this set inside
    # _generate_answer; citations below are gated to it too, so the LLM can
    # never surface a contact it was never actually given.
    answer_candidate_ids = {c.contactId for c, _ in ranked_for_answer[:_ANSWER_TOP_N]}

    return _RankCore(
        early=None,
        query=query,
        has_query=has_query,
        scored=scored,
        ranked_for_answer=ranked_for_answer,
        answer_candidate_ids=answer_candidate_ids,
        by_id=by_id,
        timings_on=_timings_on,
        t_total=_t_total,
        timing_parts=_timing_parts(),
    )


def _finalize_rank(
    core: _RankCore,
    answer: Optional[str],
    answer_status: str,
    why_map: Dict[str, str],
    rank_order: List[str],
    stage3_ms: float,
    req: PeopleRankRequest,
) -> Dict:
    """Turn a _RankCore plus a Stage-3 result into the response body.

    Stage 3 (when it ran) returned the prose blurb, the per-person why, AND the
    model's explicit relevance ranking. The ranking (when present) reorders
    people[] so the list, blurb, citations, why, and scores all derive from one
    judgment. rank_order is [] on any failure, or when Stage 3 was skipped
    outright -> we keep the embedding order and scores."""
    query = core.query
    has_query = core.has_query
    scored = core.scored
    by_id = core.by_id
    answer_candidate_ids = core.answer_candidate_ids

    # Reorder the scored candidates to the model's ranking. Ranked ids come first
    # in the model's order; any candidate the model did not rank follows in the
    # original embedding order. We never reach beyond the scored[:limit] set, so
    # this only reorders the people who were already going to be returned.
    ordered = scored
    if rank_order:
        by_cid = {t[0].contactId: t for t in scored}
        seen: set = set()
        reordered: List[Tuple[ContactIn, float, float, float]] = []
        for cid in rank_order:
            t = by_cid.get(cid)
            if t is not None and cid not in seen:
                reordered.append(t)
                seen.add(cid)
        for t in scored:
            if t[0].contactId not in seen:
                reordered.append(t)
        ordered = reordered

    # Consistency: the displayed top-level `score` must be monotonic
    # non-increasing down the (possibly reordered) list, so the UI bar never
    # shows a lower-ranked person with a higher percentage. We preserve the SET
    # of real score magnitudes (honest values) but reassign them in descending
    # order down the reranked positions. components.relevance / components.proximity
    # keep the TRUE embedding values for honesty and debugging. When the model
    # gave no ranking (fail-safe), scores are left exactly as embedding produced.
    if rank_order:
        desc = sorted((t[1] for t in ordered), reverse=True)
        display_score = {t[0].contactId: s for t, s in zip(ordered, desc)}
    else:
        display_score = {t[0].contactId: t[1] for t in ordered}

    # If the model cited people in the blurb, keep only those (in naming order,
    # which now matches rank order); otherwise fall back to the top-N as citations
    # so the app can still render.
    cited_ids: List[str] = []
    if answer:
        for m in _MARKER_RE.finditer(answer):
            cid = m.group(1).strip()
            if cid in by_id and cid in answer_candidate_ids and cid not in cited_ids:
                cited_ids.append(cid)

    people = []
    for rank, (c, final, rel, prox) in enumerate(ordered, start=1):
        missing = _missing(c)
        people.append({
            "contactId": c.contactId,
            "name": c.name,
            "company": c.company,
            "title": c.title,
            "score": round(display_score[c.contactId], 4),
            "components": {
                "proximity": round(prox, 4),
                "centrality": 0.0,
                "recency": 0.0,
                "relevance": round(rel, 4),
            },
            "drivers": _drivers(c, rel, prox, req.me, has_query),
            "missing": missing,
            # Top _WHY_TOP_N get the grounded LLM why; everyone else (and every
            # contact on any LLM failure) keeps the deterministic template.
            "reason": why_map.get(c.contactId) or _reason(c, rel, prox, req.me, has_query, missing),
            "profile": {
                "email": c.email,
                "phone": c.phone,
                "source": "apple",
            },
            "links": [],
        })

    print("PR_RESPONSE_DEBUG", json.dumps({
        "query": query,
        "people": [
            {"contactId": p["contactId"], "name": p["name"], "score": p["score"], "components": p["components"]}
            for p in people
        ],
    }), flush=True)

    rank_by_id = {p["contactId"]: i + 1 for i, p in enumerate(people)}
    score_by_id = {p["contactId"]: p["score"] for p in people}
    citation_source = cited_ids or [p["contactId"] for p in people[:_ANSWER_TOP_N]]
    citations = []
    for cid in citation_source:
        c = by_id.get(cid)
        if c is None:
            continue
        citations.append({
            "marker": f"[[p:{cid}]]",
            "contactId": cid,
            "name": c.name,
            "company": c.company,
            "title": c.title,
            "score": score_by_id.get(cid),
            "rank": rank_by_id.get(cid),
        })

    resp = {
        "query": query or None,
        "count": len(people),
        "people": people,
        "answer": answer,
        "answer_status": answer_status,
        "citations": citations,
    }
    if core.timings_on:
        parts = core.timing_parts
        parts["stage3_answer"] = round(stage3_ms, 2)
        parts["total"] = round((time.perf_counter() - core.t_total) * 1000.0, 2)
        resp["timings_ms"] = parts
    return resp


def run_people_rank(req: PeopleRankRequest) -> Dict:
    """Rank the caller's contacts and (unless req.answer is False) write the
    grounded Stage-3 answer.

    req.answer=False is the voice path: identical Stage 1 -> prefilter -> Stage 2
    ranking, no Stage-3 Claude call, `answer` null. Default True keeps the
    existing non-streaming behavior byte-identical."""
    core = _rank_core(req)
    if core.early is not None:
        return core.early

    if req.answer:
        _t_s3 = time.perf_counter()
        answer, answer_status, why_map, rank_order = _generate_answer(
            core.query, core.ranked_for_answer, req.now_local, me=req.me
        )
        stage3_ms = (time.perf_counter() - _t_s3) * 1000.0
    else:
        # Skipped by request, not by failure. why_map/rank_order stay empty, so
        # people[] keeps the embedding order and the deterministic `reason`
        # template -- exactly the fail-safe path Stage-3 failures already take.
        answer, answer_status, why_map, rank_order = None, "skipped", {}, []
        stage3_ms = 0.0

    return _finalize_rank(core, answer, answer_status, why_map, rank_order, stage3_ms, req)


# ---------------------------------------------------------------------------
# Streaming (SSE) variant — same ranking, incremental delivery
# ---------------------------------------------------------------------------


def _sse(event: str, data: Dict) -> str:
    """One Server-Sent Event frame. json.dumps escapes newlines, so a payload can
    never break the `data:` line or terminate the frame early."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def stream_people_rank(req: PeopleRankRequest):
    """Yield the SSE frames for POST /v1/me/people-rank/stream.

    Same ranking as run_people_rank (both call _rank_core), delivered in three
    phases so a text client can render immediately instead of waiting on Stage 3:

      event: people  — the ranked list, as soon as Stage 1/2 finish
      event: token   — one per text delta of the answer as it generates
      event: done    — final citations, rank order, and the reranked people[]

    The `people` event carries the pre-Stage-3 order (embedding order, template
    reasons); `done` carries the final order, LLM `reason` lines, and citations
    once the model's ranking is known. Clients should replace on `done`."""
    core = _rank_core(req)

    if core.early is not None:
        # No eligible matches: nothing to rank and no Stage-3 call to make. The
        # canned copy is emitted as a single token so a token-rendering client
        # still shows text.
        resp = core.early
        yield _sse("people", {
            "query": resp["query"], "count": resp["count"], "people": resp["people"],
        })
        if resp.get("answer"):
            yield _sse("token", {"text": resp["answer"]})
        yield _sse("done", {
            "answer": resp["answer"],
            "answer_status": resp["answer_status"],
            "citations": resp["citations"],
            "rank_order": [],
            "count": resp["count"],
            "people": resp["people"],
        })
        return

    pre = _finalize_rank(core, None, "pending", {}, [], 0.0, req)
    yield _sse("people", {
        "query": pre["query"], "count": pre["count"], "people": pre["people"],
    })

    if req.answer:
        _t_s3 = time.perf_counter()
        result: Tuple[Optional[str], str, Dict[str, str], List[str]] = (None, "error", {}, [])
        for kind, payload in _generate_answer_stream(
            core.query, core.ranked_for_answer, req.now_local, me=req.me
        ):
            if kind == "token":
                yield _sse("token", {"text": payload})
            else:
                result = payload
        stage3_ms = (time.perf_counter() - _t_s3) * 1000.0
    else:
        result = (None, "skipped", {}, [])
        stage3_ms = 0.0

    answer, answer_status, why_map, rank_order = result
    final = _finalize_rank(core, answer, answer_status, why_map, rank_order, stage3_ms, req)
    done = {
        "answer": final["answer"],
        "answer_status": final["answer_status"],
        "citations": final["citations"],
        # The model's final relevance order, as contactIds. Mirrors people[] in
        # `final`, which is included so a client can swap the list wholesale
        # rather than reorder it itself.
        "rank_order": [p["contactId"] for p in final["people"]],
        "count": final["count"],
        "people": final["people"],
    }
    if "timings_ms" in final:
        done["timings_ms"] = final["timings_ms"]
    yield _sse("done", done)
