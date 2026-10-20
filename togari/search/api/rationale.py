"""Claude-backed rationale generator with validators and retries."""
from __future__ import annotations

import logging
import os
import re
from typing import List, Optional, Tuple

from . import persist_cache
from .schemas import Attendee

logger = logging.getLogger("peoplerank.rationale")

MODEL_ID = "claude-sonnet-4-5"
MAX_TOKENS = 400
TEMPERATURE = 0.7


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "").strip() or default)
    except (TypeError, ValueError):
        return default


# Number of generate-and-validate attempts before returning best-effort text.
# Speed vs voice-purity is a live tradeoff (see git history), so it is an env
# knob: RATIONALE_MAX_RETRIES.
MAX_RETRIES = _env_int("RATIONALE_MAX_RETRIES", 1)

# Per-call wall-clock budget for a single Claude rationale request. On timeout
# the SDK raises, the attempt is logged, and we fall back to best-effort/None
# rather than hanging the whole match request. Override: RATIONALE_TIMEOUT_S.
TIMEOUT_S = _env_float("RATIONALE_TIMEOUT_S", 30.0)

# Validator strictness. "strict" (default) rejects on any banned phrase or
# detected name. "relaxed" keeps the hard formatting rules (em dash, length,
# sentence count) but downgrades soft style violations to a warning so a clean,
# readable rationale is not thrown away over one borderline phrase. Override:
# RATIONALE_STRICTNESS=relaxed.
STRICTNESS = (os.environ.get("RATIONALE_STRICTNESS", "strict").strip().lower() or "strict")

SYSTEM_PROMPT = """You are writing a short paragraph that will be shown to one person (the member) about another person (the partner) they should meet at an event. You have access to screening details for both.

VOICE RULES — violating any of these makes the output invalid:
- Addressed to the member as "you", about the partner in third person ("she", "he", "they").
- Do NOT use any first names or full names of people. Refer to the partner by pronoun or role noun only ("the paralegal", "the local"). Place names like "Austin", "East Side", "Rainey Street" ARE allowed.
- 3 to 5 sentences. Hard cap 800 characters.
- Short, declarative sentences. Periods do the work.
- Ground in specific details from screening (venues, cities, years, exact phrases). Never generic personality claims like "both thoughtful" or "both love to travel".
- NO em-dashes. No "—", no "--" used as an em-dash, no en-dashes. Use a period or a comma.
- NO hedge language: no "might", "could be", "potentially", "seems to", "likely".
- NO AI pattern phrases: no "not just X but Y", "in a world where", "dynamic blend", "perfect match", "shared passion for", "unique opportunity", "rich tapestry".
- NO meta commentary: no "here is why this works", no "this match stands out".
- NO superlatives without specifics. "Amazing" is banned unless followed immediately by the specific thing.
- NO corporate verbs: "leverage", "align", "embrace", "curate".
- Close with a specific action or prediction, not a feeling.

STRUCTURE: one observation about the member. one observation about the partner. one line about where their truths meet. one action or prediction to close. Short rationales are fine when the match is clean; do not pad.

OUTPUT: the rationale paragraph only. No preamble, no explanation, no quotes around it."""


FIVE_EXAMPLES = """FIVE EXAMPLES of the voice we want (read these before writing):

Example 1:
You have a 24-year map of Austin and you are still finding new pockets of it. She landed in January with nothing. No friends, no spots, no shortcuts, and she got quietly good at arriving alone. She wants the city you grew up in. You will remember parts of it by telling her.

Example 2:
She pulls people into acro yoga and slacklining on the first hangout. Your idea of a weekend is a fantasy draft and a show, not a couch. Two Austinites the same age who both refuse to sit still. She will have a Saturday plan before coffee cools.

Example 3:
You both left DC within a year of each other and are quietly rebuilding from scratch. You moved last summer and jumped into a fantasy league you are still learning. He baked bread through his first Austin winter and flew somewhere alone for his 31st. Neither of you is making a show of the reset. Ask him what winter here taught him.

Example 4:
You arrived four weeks ago and you already have a private rule about third places. She has been here six years and thirty-seven countries and still writes a list of people she wants to meet this week. You are both running on appetite. She will be the one who texts you at noon asking if you have eaten yet, and then takes you somewhere you did not know existed.

Example 5:
You both moved from a job you loved for a reason you do not fully want to explain yet. She left publishing in March. You left teaching in June. If you want to skip the small talk, start with whichever one of you is more tired today."""


# Banned as full substrings: these are AI-tell phrases that should never appear naturally
BANNED_SUBSTRINGS = [
    "in a world where", "dynamic blend", "perfect match",
    "rich tapestry", "here is why", "this match stands out",
    "what makes this special", "could be potentially", "seems to likely",
    # Additional AI tells observed slipping past the prompt.
    "needless to say", "it goes without saying", "when it comes to",
    "at the end of the day", "two peas in a pod", "match made in heaven",
    "birds of a feather", "kindred spirits", "meant to be", "hit it off",
]

# Banned only when matching a specific regex pattern (avoids false positives on common words)
# Each entry: (pattern, human_reason)
BANNED_PATTERNS = [
    # "not just X but Y" structure — the real AI tell
    (r"\bnot just\b[^.!?]*\bbut\b", "not_just_but"),
    # Hedge words, as whole words only
    (r"\bmight be\b", "might_be"),
    (r"\bcould be\b", "could_be"),
    (r"\bpotentially\b", "potentially"),
    (r"\bseems to\b", "seems_to"),
    # Corporate verbs only as standalone words
    (r"\bleverage\b", "leverage"),
    (r"\bleveraging\b", "leveraging"),
    (r"\balign with\b", "align_with"),
    (r"\baligned with\b", "aligned_with"),
    (r"\balignment with\b", "alignment_with"),
    (r"\bembrace\b", "embrace"),
    (r"\bembraces\b", "embraces"),
    (r"\bembracing\b", "embracing"),
    # "shared passion for" — exact phrase
    (r"\bshared passion for\b", "shared_passion_for"),
    # "unique opportunity" — exact phrase
    (r"\bunique opportunity\b", "unique_opportunity"),
]

# Common first names we should flag if they appear followed by Title Case.
# We only flag TWO-Title-Case phrases where the FIRST word is a plausible first name.
COMMON_FIRST_NAMES = {
    "James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph",
    "Thomas", "Charles", "Christopher", "Daniel", "Matthew", "Anthony", "Mark",
    "Donald", "Steven", "Paul", "Andrew", "Joshua", "Kenneth", "Kevin", "Brian",
    "George", "Edward", "Ronald", "Timothy", "Jason", "Jeffrey", "Ryan", "Jacob",
    "Gary", "Nicholas", "Eric", "Jonathan", "Stephen", "Larry", "Justin", "Scott",
    "Brandon", "Benjamin", "Samuel", "Gregory", "Frank", "Alexander", "Raymond",
    "Patrick", "Jack", "Dennis", "Jerry", "Tyler", "Aaron", "Jose", "Henry",
    "Adam", "Douglas", "Nathan", "Peter", "Zachary", "Kyle", "Noah", "Ethan",
    "Jeremy", "Walter", "Christian", "Sean", "Alan", "Keith", "Mohammed", "Ahmed",
    "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan",
    "Jessica", "Sarah", "Karen", "Nancy", "Lisa", "Betty", "Helen", "Sandra",
    "Donna", "Carol", "Ruth", "Sharon", "Michelle", "Laura", "Emily", "Kimberly",
    "Deborah", "Dorothy", "Amy", "Angela", "Ashley", "Brenda", "Emma", "Olivia",
    "Cynthia", "Marie", "Janet", "Catherine", "Frances", "Christine", "Samantha",
    "Debra", "Rachel", "Carolyn", "Virginia", "Maria", "Heather", "Diane",
    "Julie", "Joyce", "Victoria", "Kelly", "Christina", "Joan", "Evelyn",
    "Lauren", "Judith", "Megan", "Andrea", "Cheryl", "Hannah", "Jacqueline",
    "Martha", "Gloria", "Teresa", "Ann", "Sara", "Madison", "Frances", "Kathryn",
    "Janice", "Jean", "Abigail", "Alice", "Julia", "Judy", "Sophia", "Grace",
    "Denise", "Amber", "Doris", "Marilyn", "Danielle", "Beverly", "Isabella",
    "Theresa", "Diana", "Natalie", "Brittany", "Charlotte", "Marie", "Kayla",
    "Alexis", "Lori", "Carlo", "Karthik", "Kevin", "Mike", "Maggie", "Gwen",
    "Sagar", "Caleb", "Kaitlyn", "Angela", "Reem", "Rania"
}


# ---------- Validators ----------

def _split_sentences(text: str) -> List[str]:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p for p in parts if p.strip()]


def _has_person_name(text: str) -> bool:
    """
    Only flag if we find a COMMON_FIRST_NAME as a standalone Title-Case token.
    This avoids false positives on place names like "East Side", "Rainey Street".
    """
    # Find all Title-Case words in the text (anywhere)
    words = re.findall(r"\b[A-Z][a-z]+\b", text)
    for w in words:
        if w in COMMON_FIRST_NAMES:
            return True
    return False


def validate_rationale(text: str, strictness: Optional[str] = None) -> Tuple[bool, str]:
    """Return (ok, reason).

    Hard rules (empty, length, em/en dash, double dash, sentence count) always
    fail validation. Soft style rules (banned phrases, detected names) fail in
    "strict" mode and only warn in "relaxed" mode, so a clean rationale is not
    discarded over one borderline phrase. Strictness defaults to the module-
    level STRICTNESS (env RATIONALE_STRICTNESS).
    """
    mode = (strictness or STRICTNESS).lower()
    soft_is_fatal = mode != "relaxed"

    if not text or not text.strip():
        return False, "empty"
    if len(text) > 800:
        return False, f"too_long:{len(text)}"
    if "\u2014" in text:
        return False, "em_dash"
    if re.search(r"\S\s*\u2013\s*\S", text):
        return False, "en_dash_between_words"
    if " -- " in text:
        return False, "double_dash"
    sentences = _split_sentences(text)
    if not (2 <= len(sentences) <= 7):
        return False, f"sentence_count:{len(sentences)}"

    soft_violation: Optional[str] = None
    lower = text.lower()
    for sub in BANNED_SUBSTRINGS:
        if sub in lower:
            soft_violation = f"banned_sub:{sub}"
            break
    if soft_violation is None:
        for pattern, reason in BANNED_PATTERNS:
            if re.search(pattern, lower):
                soft_violation = f"banned_pat:{reason}"
                break
    if soft_violation is None and _has_person_name(text):
        soft_violation = "person_name_detected"

    if soft_violation is not None:
        if soft_is_fatal:
            return False, soft_violation
        logger.info("rationale passed in relaxed mode despite soft violation: %s", soft_violation)
    return True, "ok"


# ---------- User prompt builder ----------

def _fmt_host_notes(a: Attendee) -> str:
    if not a.hostNotes:
        return "none"
    return " | ".join(hn.notes for hn in a.hostNotes if hn.notes) or "none"


def _fmt_feedback(a: Attendee) -> str:
    if not a.feedback:
        return "none"
    parts = []
    for f in a.feedback:
        bits = []
        if f.highlight:
            bits.append(f"highlight: {f.highlight}")
        if f.myDinner:
            bits.append(f"dinner: {f.myDinner}")
        if f.nextBigEvent:
            bits.append(f"next: {f.nextBigEvent}")
        if bits:
            parts.append("; ".join(bits))
    return " || ".join(parts) if parts else "none"


def _fmt_person_block(a: Attendee) -> str:
    return (
        f"- Age: {a.age if a.age is not None else 'unknown'}\n"
        f"- City: {a.city or 'unknown'}\n"
        f"- Occupation: {a.occupation or 'unknown'}\n"
        f"- Archetype: {a.guestType or 'unknown'}, {', '.join(a.guestArchetype) or 'none'}\n"
        f"- Why they joined: {a.whyJoin or 'unknown'}\n"
        f"- Social bravery example: {a.socialBravery or 'unknown'}\n"
        f"- Passion: {a.passion or 'unknown'}\n"
        f"- Screening notes: {a.screeningNotes or 'none'}\n"
        f"- Host notes from past events: {_fmt_host_notes(a)}\n"
        f"- Post-event feedback highlights: {_fmt_feedback(a)}"
    )


def build_user_prompt(member: Attendee, partner: Attendee) -> str:
    return (
        "MEMBER (the reader, addressed as \"you\"):\n"
        f"{_fmt_person_block(member)}\n\n"
        "PARTNER (the person being suggested):\n"
        f"{_fmt_person_block(partner)}\n\n"
        "Now write the rationale."
    )


# ---------- Claude call ----------

_client = None


def _get_client():
    global _client
    if _client is None:
        from anthropic import Anthropic
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        _client = Anthropic(api_key=api_key, timeout=TIMEOUT_S)
    return _client


def _call_claude(user_prompt: str) -> str:
    client = _get_client()
    resp = client.messages.create(
        model=MODEL_ID,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT + "\n\n" + FIVE_EXAMPLES,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_prompt}],
    )
    out = "".join(
        getattr(block, "text", "") for block in resp.content
        if getattr(block, "type", None) == "text"
    ).strip()
    return out


def scrub_ai_tells(text: str) -> str:
    """Strip em-dashes, smart quotes, and common AI writing tells. Applied to every rationale."""
    if not text:
        return text
    # Smart quotes to straight quotes
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    # Em-dash and en-dash to comma (reads natural, matches voice rules)
    text = text.replace("\u2014", ", ").replace("\u2013", ", ")
    # Double hyphen used as em-dash
    text = re.sub(r"\s--\s", ", ", text)
    text = re.sub(r"(?<=\w)--(?=\w)", ", ", text)
    # Strip common AI hedge phrases that slip past the prompt
    ai_phrases = [
        r"\bIt's worth noting that\s*",
        r"\bThat said,?\s*",
        r"\bMoreover,?\s*",
        r"\bFurthermore,?\s*",
        r"\bIn essence,?\s*",
        r"\bUltimately,?\s*",
        r"\bAt the end of the day,?\s*",
    ]
    for pat in ai_phrases:
        text = re.sub(pat, "", text, flags=re.IGNORECASE)
    # Collapse double commas and whitespace introduced by substitutions
    text = re.sub(r",\s*,", ",", text)
    text = re.sub(r"\s+,", ",", text)
    text = re.sub(r"\s+\.", ".", text)
    text = re.sub(r"\s{2,}", " ", text)
    # Capitalize first letter if we trimmed a leading phrase
    text = text.strip()
    if text and text[0].islower():
        text = text[0].upper() + text[1:]
    return text


# Bumped whenever the prompt, examples, or validator change so stale cached
# rationales from an older voice do not get served after a deploy.
_RATIONALE_CACHE_VERSION = "v1"


def _rationale_cache_key(user_prompt: str, system_prompt: str) -> str:
    return persist_cache.make_key(
        _RATIONALE_CACHE_VERSION, MODEL_ID, system_prompt, user_prompt
    )


def generate_rationale(
    member: Attendee,
    partner: Attendee,
    max_retries: int = MAX_RETRIES,
) -> Optional[str]:
    """Return a validated rationale or None after exhausting retries.

    Successful rationales are cached on disk keyed by the exact prompt content,
    so a retried match request (same roster after a client timeout) returns the
    same text instantly with no Claude spend.
    """
    user_prompt = build_user_prompt(member, partner)
    cache_key = _rationale_cache_key(user_prompt, SYSTEM_PROMPT + "\n\n" + FIVE_EXAMPLES)
    cached = persist_cache.get("rationale", cache_key)
    if isinstance(cached, str) and cached.strip():
        return cached

    pair_tag = f"{member.id}->{partner.id}"
    last_text = None
    for attempt in range(1, max_retries + 1):
        try:
            text = _call_claude(user_prompt)
        except Exception as e:
            logger.warning("rationale %s attempt %d api_error: %s", pair_tag, attempt, e)
            continue
        text = scrub_ai_tells(text)
        last_text = text
        ok, reason = validate_rationale(text)
        if ok:
            if attempt > 1:
                logger.info("rationale %s succeeded on attempt %d", pair_tag, attempt)
            persist_cache.set("rationale", cache_key, text)
            return text
        snippet = text[:120].replace("\n", " ")
        logger.warning(
            "rationale %s attempt %d failed validator: %s | text: %s...",
            pair_tag, attempt, reason, snippet,
        )
    if last_text:
        logger.warning("rationale %s EXHAUSTED %d retries, returning best-effort text", pair_tag, max_retries)
        return last_text
    logger.warning("rationale %s EXHAUSTED %d retries with no text received", pair_tag, max_retries)
    return None



# ============================================================
# UC3 — Group rationales
# ============================================================

UC3_MEMBER_SYSTEM_PROMPT = """You are writing a 1-2 sentence rationale that one member of a small group will read about another member of the same group. They are about to spend an hour or two together (a carpool, a dinner, a workshop table).

VOICE RULES — violating any of these makes the output invalid:
- Addressed to the reader as "you", about the carmate in third person ("she", "he", "they").
- Do NOT use first names or full names of people. Refer to the carmate by pronoun or role noun only ("the bike-shop guy", "the new arrival"). Place names like "Austin", "Carnival", "Boulder" ARE allowed.
- 1 to 2 sentences. Hard cap 350 characters.
- Short, declarative sentences. Periods do the work.
- Ground in specific details from screening (venues, cities, years, exact phrases). Never generic personality claims.
- NO em-dashes. No "—", no "--", no en-dashes. Use a period or a comma.
- NO hedge language: no "might", "could be", "potentially", "seems to", "likely".
- NO AI pattern phrases: no "not just X but Y", "in a world where", "dynamic blend", "perfect match".
- NO meta commentary: no "here is why", no "this person stands out".
- NO superlatives without specifics.
- NO corporate verbs: "leverage", "align", "embrace", "curate".
- Close with a specific observation or prediction tied to the next hour or two together, not a feeling.
- Do NOT title-drop the role ("the driver", "the host"). The surrounding UI handles that. Just describe the person.

OUTPUT: the rationale only. No preamble, no explanation, no quotes."""

UC3_GROUP_SYSTEM_PROMPT = """You are writing a 1-2 sentence group-level rationale that all members of a small group will read. It is the "why these N together" claim.

VOICE RULES — violating any of these makes the output invalid:
- Third-person observational. NO "you" address.
- Do NOT use first names or full names of people. Refer to members by pronoun or role noun only.
- 1 to 2 sentences. Hard cap 350 characters.
- Name the contrast that holds the group together (Austin lifers + transplants, quiet observer + storyteller, etc.).
- Hint at what the next hour or two will produce. A vivid scene works.
- NO em-dashes, NO hedge language, NO AI pattern phrases, NO meta commentary, NO corporate verbs (same rules as member rationales).
- Read like a coordinator's note to the group, not a marketing one-liner.

OUTPUT: the rationale only. No preamble, no explanation, no quotes."""


def _attendee_blob(a: Attendee) -> str:
    """Compact text blob for a single attendee — feeds into UC3 prompts."""
    parts = []
    if getattr(a, "age", None) is not None:
        parts.append(f"Age: {a.age}")
    if getattr(a, "gender", None):
        parts.append(f"Gender: {a.gender}")
    if getattr(a, "city", None):
        parts.append(f"City: {a.city}")
    if getattr(a, "occupation", None):
        parts.append(f"Occupation: {a.occupation}")
    if getattr(a, "guestType", None):
        parts.append(f"Type: {a.guestType}")
    if getattr(a, "passion", None):
        parts.append(f"Passion: {a.passion}")
    if getattr(a, "whyJoin", None):
        parts.append(f"Why joined: {a.whyJoin}")
    if getattr(a, "socialBravery", None):
        parts.append(f"Social bravery: {a.socialBravery}")
    if getattr(a, "screeningNotes", None):
        parts.append(f"Screening notes: {a.screeningNotes}")
    host_notes = getattr(a, "hostNotes", []) or []
    if host_notes:
        hn_texts = []
        for hn in host_notes:
            note = getattr(hn, "notes", None) or getattr(hn, "note", None) or getattr(hn, "observation", None)
            if note:
                hn_texts.append(str(note))
        if hn_texts:
            parts.append("Host notes: " + " | ".join(hn_texts))
    feedback = getattr(a, "feedback", []) or []
    if feedback:
        fb_texts = []
        for fb in feedback:
            for field in ("highlight", "myDinner", "nextBigEvent"):
                v = getattr(fb, field, None)
                if v:
                    fb_texts.append(str(v))
        if fb_texts:
            parts.append("Prior feedback: " + " | ".join(fb_texts))
    return "\n".join(parts)


def _call_claude_with_system(system_prompt: str, user_prompt: str) -> str:
    """Like _call_claude but with a custom system prompt."""
    import anthropic
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=TIMEOUT_S)
    message = client.messages.create(
        model=MODEL_ID,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_prompt}],
    )
    text = "".join(block.text for block in message.content if hasattr(block, "text"))
    return text.strip()


def generate_member_rationale(
    reader: Attendee,
    carmate: Attendee,
    max_retries: int = MAX_RETRIES,
) -> Optional[str]:
    """Per-member rationale: addressed to `reader` (as "you"), about `carmate`."""
    user_prompt = (
        f"You are writing a rationale that the reader will see about a person who will be in their group.\n\n"
        f"=== READER (the person who will read this) ===\n{_attendee_blob(reader)}\n\n"
        f"=== CARMATE (the person being described) ===\n{_attendee_blob(carmate)}\n\n"
        f"Write the rationale for the reader about the carmate. Follow the voice rules exactly."
    )
    pair_tag = f"uc3_member:{reader.id}->{carmate.id}"
    last_text = None
    for attempt in range(1, max_retries + 1):
        try:
            text = _call_claude_with_system(UC3_MEMBER_SYSTEM_PROMPT, user_prompt)
        except Exception as e:
            logger.warning("rationale %s attempt %d api_error: %s", pair_tag, attempt, e)
            continue
        text = scrub_ai_tells(text)
        last_text = text
        ok, reason = validate_rationale(text)
        if ok:
            return text
        logger.warning("rationale %s attempt %d failed validator: %s", pair_tag, attempt, reason)
    if last_text:
        logger.warning("rationale %s EXHAUSTED, returning best-effort", pair_tag)
        return last_text
    logger.warning("rationale %s EXHAUSTED with no text", pair_tag)
    return None


def generate_group_rationale(
    members: List[Attendee],
    member_rationales: List[str],
    max_retries: int = MAX_RETRIES,
) -> Optional[str]:
    """Group-level rationale: third-person, names the contrast.

    Receives both raw attendee data AND the per-member rationales already
    generated, so it can echo language and synthesize a coherent line.
    """
    blob_sections = []
    for a, r in zip(members, member_rationales):
        rationale_line = r if r else "(no rationale generated)"
        blob_sections.append(f"--- MEMBER {a.id} ---\n{_attendee_blob(a)}\n\nWritten rationale about this member: {rationale_line}")
    user_prompt = (
        f"You are writing the group-level rationale for these {len(members)} people who will spend an hour or two together.\n\n"
        + "\n\n".join(blob_sections)
        + "\n\nWrite the group rationale. 1-2 sentences. Name the contrast. Third person. Follow the voice rules exactly."
    )
    pair_tag = f"uc3_group:{members[0].id}+{len(members)}"
    last_text = None
    for attempt in range(1, max_retries + 1):
        try:
            text = _call_claude_with_system(UC3_GROUP_SYSTEM_PROMPT, user_prompt)
        except Exception as e:
            logger.warning("rationale %s attempt %d api_error: %s", pair_tag, attempt, e)
            continue
        text = scrub_ai_tells(text)
        last_text = text
        ok, reason = validate_rationale(text)
        if ok:
            return text
        logger.warning("rationale %s attempt %d failed validator: %s", pair_tag, attempt, reason)
    if last_text:
        logger.warning("rationale %s EXHAUSTED, returning best-effort", pair_tag)
        return last_text
    logger.warning("rationale %s EXHAUSTED with no text", pair_tag)
    return None


# ============================================================
# Async batch generation
# ============================================================
#
# The route handler today fans rationale calls out across a ThreadPoolExecutor
# (4 workers). That works but each worker holds a blocking HTTP call and the
# pool size caps concurrency hard. These async helpers let the caller run many
# rationales on a single event loop with AsyncAnthropic and an asyncio
# Semaphore, which scales better for large rosters and frees the caller from
# thread management. The sync API above is unchanged; wiring main.py to use the
# batch path is an orchestrator step (Tab 13 does not own main.py).

import asyncio  # noqa: E402

# Default in-flight concurrency for the async batch path. Override with
# RATIONALE_CONCURRENCY.
CONCURRENCY = _env_int("RATIONALE_CONCURRENCY", 8)

_async_client = None


def _get_async_client():
    global _async_client
    if _async_client is None:
        from anthropic import AsyncAnthropic
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        _async_client = AsyncAnthropic(api_key=api_key, timeout=TIMEOUT_S)
    return _async_client


async def _call_claude_async(system_prompt: str, user_prompt: str, cache_system: bool) -> str:
    client = _get_async_client()
    if cache_system:
        system = [{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}]
    else:
        system = [{"type": "text", "text": system_prompt}]
    resp = await client.messages.create(
        model=MODEL_ID,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        system=system,
        messages=[{"role": "user", "content": user_prompt}],
    )
    out = "".join(
        getattr(block, "text", "") for block in resp.content
        if getattr(block, "type", None) == "text"
    ).strip()
    return out


async def _generate_async(
    system_prompt: str,
    user_prompt: str,
    cache_namespace: Optional[str],
    cache_key: Optional[str],
    pair_tag: str,
    max_retries: int,
    cache_system: bool,
) -> Optional[str]:
    """Shared async generate-validate loop with optional disk cache."""
    if cache_namespace and cache_key:
        cached = persist_cache.get(cache_namespace, cache_key)
        if isinstance(cached, str) and cached.strip():
            return cached
    last_text = None
    for attempt in range(1, max_retries + 1):
        try:
            text = await _call_claude_async(system_prompt, user_prompt, cache_system)
        except Exception as e:
            logger.warning("rationale %s async attempt %d api_error: %s", pair_tag, attempt, e)
            continue
        text = scrub_ai_tells(text)
        last_text = text
        ok, reason = validate_rationale(text)
        if ok:
            if cache_namespace and cache_key:
                persist_cache.set(cache_namespace, cache_key, text)
            return text
        logger.warning("rationale %s async attempt %d failed validator: %s", pair_tag, attempt, reason)
    if last_text:
        logger.warning("rationale %s async EXHAUSTED, returning best-effort", pair_tag)
        return last_text
    return None


async def generate_rationale_async(
    member: Attendee,
    partner: Attendee,
    max_retries: int = MAX_RETRIES,
) -> Optional[str]:
    """Async equivalent of generate_rationale (UC1 pair)."""
    user_prompt = build_user_prompt(member, partner)
    system_prompt = SYSTEM_PROMPT + "\n\n" + FIVE_EXAMPLES
    cache_key = _rationale_cache_key(user_prompt, system_prompt)
    return await _generate_async(
        system_prompt, user_prompt, "rationale", cache_key,
        f"{member.id}->{partner.id}", max_retries, cache_system=True,
    )


async def generate_rationales_batch(
    pairs: List[Tuple[Attendee, Attendee]],
    concurrency: int = CONCURRENCY,
    max_retries: int = MAX_RETRIES,
) -> List[Optional[str]]:
    """Generate many UC1 pair rationales concurrently on one event loop.

    Returns results in the same order as `pairs`. Concurrency is bounded by an
    asyncio Semaphore so a large roster does not open hundreds of simultaneous
    Claude connections. Each pair degrades to None on failure rather than
    failing the whole batch.
    """
    if not pairs:
        return []
    sem = asyncio.Semaphore(max(1, concurrency))

    async def _one(member: Attendee, partner: Attendee) -> Optional[str]:
        async with sem:
            try:
                return await generate_rationale_async(member, partner, max_retries=max_retries)
            except Exception as e:
                logger.warning("batch rationale %s->%s failed: %s", member.id, partner.id, e)
                return None

    return await asyncio.gather(*[_one(m, p) for (m, p) in pairs])
