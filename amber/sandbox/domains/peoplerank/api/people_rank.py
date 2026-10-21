"""PeopleRank — query-driven ranking over the caller's own contacts.

This is the surface the Amber iOS middle tab consumes. Where
`/v1/match/community-event` matches a curated event roster into mutual pairs,
this endpoint answers the simpler, search-style question the app asks:

    "Given everything I know about my network, who should I reach out to?"

It reuses the repo's own PeopleRank machinery:
  - `peoplerank.embeddings.OpenAIBackend` for semantic query->contact relevance
  - a light structured "warmth" signal (shared city / company with the caller)
  - the Anthropic rationale writer for a grounded, cited natural-language answer

The response shape is byte-for-byte what `apps/mobile/lib/peoplerank.ts`
already parses: `people[]` with score + components + reason, an `answer`
string carrying inline `[[p:CONTACT_ID]]` markers, and a `citations[]` array.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

# Make src/ importable (mirrors api/scoring.py)
_ROOT = Path(__file__).resolve().parent.parent
_SRC = str(_ROOT / "src")
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from . import persist_cache  # noqa: E402
from .schemas import ContactIn, MeProfile, PeopleRankRequest  # noqa: E402

# Embedding model: small is plenty for query<->contact relevance and far
# cheaper than 3-large when a user has hundreds of contacts.
_EMBED_MODEL = "text-embedding-3-small"
_ANSWER_MODEL = "claude-sonnet-4-5"
_ANSWER_TOP_N = 6

# How long to wait on the single grounded-answer Claude call before giving up
# and returning the ranked people without an answer. The ranking itself never
# depends on this call, so a slow model degrades to "people, no prose" instead
# of failing the request. Override with PEOPLERANK_ANSWER_TIMEOUT_S.
_ANSWER_TIMEOUT_S = float(os.environ.get("PEOPLERANK_ANSWER_TIMEOUT_S", "20"))

# Final-score blend when a query is present. Relevance (what you asked for)
# dominates, but a small warmth term breaks ties toward people the caller is
# actually close to, so two equally on-topic contacts rank the warmer one
# first. With no query, warmth carries the whole signal. Tune via env without
# a redeploy: PEOPLERANK_W_RELEVANCE / PEOPLERANK_W_WARMTH (they are
# renormalized, so they need not sum to 1).
_W_RELEVANCE = float(os.environ.get("PEOPLERANK_W_RELEVANCE", "0.85"))
_W_WARMTH = float(os.environ.get("PEOPLERANK_W_WARMTH", "0.15"))


def _clamp01(v: float) -> float:
    if v < 0:
        return 0.0
    if v > 1:
        return 1.0
    return float(v)


def _contact_doc(c: ContactIn) -> str:
    """Flatten a contact into one text doc for embedding."""
    return " ".join(
        x for x in [c.name, c.title, c.company, c.city, c.notes] if x
    ).strip()


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
# Warmth: light structured proximity to the caller (no query needed)
# ---------------------------------------------------------------------------


def _warmth(me: Optional[MeProfile], c: ContactIn) -> float:
    """Crude 0..1 proximity: shared city / company / occupation tokens with me."""
    if me is None:
        return 0.0
    score = 0.0
    if me.city and c.city and me.city.strip().lower() == c.city.strip().lower():
        score += 0.5
    if me.occupation:
        occ_tokens = _tokens(me.occupation)
        ctx_tokens = _tokens(" ".join(x for x in [c.title, c.company] if x))
        if occ_tokens & ctx_tokens:
            score += 0.5
    return _clamp01(score)


# ---------------------------------------------------------------------------
# Reason line (template, deterministic, no LLM cost per-contact)
# ---------------------------------------------------------------------------


def _reason(c: ContactIn, relevance: float, warmth: float, has_query: bool) -> str:
    role = " ".join(x for x in [c.title, ("at " + c.company) if c.company else ""] if x).strip()
    if has_query:
        if relevance >= 0.55:
            lead = "Strong match for what you asked"
        elif relevance >= 0.35:
            lead = "Relevant to your search"
        else:
            lead = "A looser match"
        return f"{lead}." + (f" {role}." if role else "")
    if warmth >= 0.5:
        return "Close to you in city or work." + (f" {role}." if role else "")
    return role or "In your synced network."


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


_ANSWER_SYSTEM = (
    "You are Amber, helping someone reason over the people in their own network. "
    "You are given the user's question and a short ranked list of their contacts, "
    "each with an exact citation marker. Write 2 to 3 sentences recommending who "
    "to reach out to and why. Reference each person you name with their exact "
    "[[p:CONTACT_ID]] marker placed immediately after their name. Only mention "
    "people from the provided list. Be specific and warm, never generic. "
    "Do not use em dashes. Do not use emojis."
)


def _generate_answer(query: str, ranked: List[Tuple[ContactIn, float]]) -> Tuple[Optional[str], str]:
    """Return (answer, answer_status). Status mirrors the app's expectations."""
    if not query:
        return None, "skipped"
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None, "no_key"
    top = ranked[:_ANSWER_TOP_N]
    if not top:
        return None, "skipped"
    lines = []
    for c, _ in top:
        role = " ".join(x for x in [c.title, ("at " + c.company) if c.company else ""] if x).strip()
        lines.append(f"- {c.name} [[p:{c.contactId}]]" + (f" — {role}" if role else ""))
    people_block = "\n".join(lines)
    user_prompt = (
        f"Question: {query}\n\n"
        f"Ranked contacts (most relevant first):\n{people_block}\n\n"
        "Write the recommendation now, citing each person you name with their marker."
    )
    try:
        from anthropic import Anthropic

        # Per-request timeout so a slow model does not hold the whole rank
        # response hostage. On timeout the SDK raises and we fall through to
        # returning the ranked people with answer_status "timeout".
        client = Anthropic(
            api_key=os.environ["ANTHROPIC_API_KEY"],
            timeout=_ANSWER_TIMEOUT_S,
        )
        resp = client.messages.create(
            model=_ANSWER_MODEL,
            max_tokens=300,
            temperature=0.6,
            system=[{"type": "text", "text": _ANSWER_SYSTEM}],
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(
            getattr(b, "text", "") for b in resp.content
            if getattr(b, "type", None) == "text"
        )
        text = _scrub(text)
        return (text or None), ("ok" if text else "error")
    except Exception as e:
        # Distinguish a timeout (slow, transient) from other failures so the
        # client can show "still ranking" copy rather than a hard error.
        status = "timeout" if _is_timeout(e) else "error"
        return None, status


def _is_timeout(err: Exception) -> bool:
    name = type(err).__name__.lower()
    if "timeout" in name:
        return True
    return "timed out" in str(err).lower()


_MARKER_RE = re.compile(r"\[\[p:([^\]]+)\]\]")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def run_people_rank(req: PeopleRankRequest) -> Dict:
    contacts = req.contacts or []
    query = (req.query or "").strip()
    has_query = bool(query)
    limit = max(1, min(req.limit or 15, 50))

    by_id: Dict[str, ContactIn] = {c.contactId: c for c in contacts}
    docs = [_contact_doc(c) for c in contacts]

    relevance: List[float]
    if has_query:
        relevance = _relevance(query, docs)
    else:
        relevance = [0.0 for _ in contacts]

    warmth = [_warmth(req.me, c) for c in contacts]

    # Final ranking signal. With a query: a renormalized blend of relevance
    # (dominant) and warmth (tie-breaker toward close contacts). With no query:
    # warmth carries the whole signal. See _W_RELEVANCE / _W_WARMTH.
    w_rel, w_warm = _W_RELEVANCE, _W_WARMTH
    w_total = w_rel + w_warm
    if w_total <= 0:
        w_rel, w_warm, w_total = 1.0, 0.0, 1.0

    scored: List[Tuple[ContactIn, float, float, float]] = []
    for c, rel, warm in zip(contacts, relevance, warmth):
        rel_c = _clamp01(rel)
        warm_c = _clamp01(warm)
        final = (w_rel * rel_c + w_warm * warm_c) / w_total if has_query else warm_c
        scored.append((c, _clamp01(final), rel_c, warm_c))

    # Deterministic fallback ordering: when the primary signal ties (e.g. a
    # cold-start network with no query and no warmth, or an all-zero relevance
    # row when every vector path failed), break ties by warmth then name so the
    # list is stable and meaningful instead of arbitrary input order.
    scored.sort(key=lambda t: (-t[1], -t[3], (t[0].name or "").lower()))
    scored = scored[:limit]

    ranked_for_answer = [(c, final) for (c, final, _, _) in scored]
    answer, answer_status = _generate_answer(query, ranked_for_answer)

    # If the model cited people, keep only those (and preserve their rank order);
    # otherwise fall back to the top-N as citations so the app can still render.
    cited_ids: List[str] = []
    if answer:
        for m in _MARKER_RE.finditer(answer):
            cid = m.group(1).strip()
            if cid in by_id and cid not in cited_ids:
                cited_ids.append(cid)

    people = []
    for rank, (c, final, rel, warm) in enumerate(scored, start=1):
        people.append({
            "contactId": c.contactId,
            "name": c.name,
            "company": c.company,
            "title": c.title,
            "score": round(final, 4),
            "components": {
                "warmth": round(warm, 4),
                "centrality": 0.0,
                "recency": 0.0,
                "relevance": round(rel, 4),
            },
            "reason": _reason(c, rel, warm, has_query),
            "profile": {
                "email": c.email,
                "phone": c.phone,
                "source": "apple",
            },
            "links": [],
        })

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

    return {
        "query": query or None,
        "count": len(people),
        "people": people,
        "answer": answer,
        "answer_status": answer_status,
        "citations": citations,
    }
