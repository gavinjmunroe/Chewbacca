#!/usr/bin/env python3
"""Read an inbound cold-email reply: what it asks for, its clean text, and
whether a drafted answer may go out with nobody pressing anything.

  gtme-reply intent   < reply.txt     kind, label, next step, addresses
  gtme-reply clean    < reply.html    the text a person typed, then the card view
  gtme-reply autosend < verdict.json  {ok, reasons} for one drafted answer
  gtme-reply campaign "Zeutara | Ivy | Pre-seed" --client Zeutara
  gtme-reply name "Gary Zimmermane" --email gary.zimmerman@firm.example
  gtme-reply names < names.txt    does this feeder append "e" to every name
  gtme-reply ooo < reply.txt      is this an out-of-office auto-reply

Lead names and auto-replies are synced from src/replies/lead-name.ts and
card-copy.ts (cleanLeadName, feederAppendsE, isAutoReply).

Synced from togari-platform 8d7ad77 (these four unchanged since 9faffef), src/agents/smartlead-responder/*:
  reply-intent.ts   replyIntent, AUTO_HANDLED
  reply-text.ts     cleanReplyText, stripEmDashes
  fit-review.ts     readableReply, splitCampaign
  auto-send.ts      autoSendable, CARRIES_PAYLOAD
Resync when the live bot's rules change. One deliberate addition: a
"bounce" kind for delivery failures, which upstream leaves as "unclear". tests/test_gtme_reply.py carries
every case from the TypeScript tests, so a resync can be checked against them.

Offline and stdlib only. Nothing here reads a mailbox or sends anything.

The rules are JavaScript regexes, and Python's engine disagrees with V8 on
\\s, \\d, \\b, ".", "$", case folding and string length (JS counts UTF-16 code
units, so an emoji is two). js_regex() rewrites each pattern into the Python
form that matches what V8 matches, and every function works on strings with
astral characters split into surrogate pairs, so a {3,40} bound or a 6000-char
cap counts what the TypeScript counts. One deliberate divergence: the upstream
entity decoder looks names up on a plain object, so "&constructor;" decodes
to the source text of Object() there. Here it stays "&constructor;".
"""

import argparse
import json
import math
import re
import sys

# --- JavaScript string and regex semantics --------------------------------

# What V8 calls whitespace for \s and String.prototype.trim. Python's own set
# adds \x1c-\x1f and \x85 and drops \ufeff.
WS = "\t\n\x0b\x0c\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_WS_CHARS = set("\t\n\x0b\x0c\r \u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff") | {
    chr(c) for c in range(0x2000, 0x200B)}
LINE_END = "\n\r\u2028\u2029"
WORD = "A-Za-z0-9_"
BOUNDARY = f"(?:(?<=[{WORD}])(?![{WORD}])|(?<![{WORD}])(?=[{WORD}]))"
NOT_BOUNDARY = f"(?:(?<=[{WORD}])(?=[{WORD}])|(?<![{WORD}])(?![{WORD}]))"


def to_js(text):
    """Split astral characters into surrogate pairs, the way a JS string holds them."""
    if not any(ord(c) > 0xFFFF for c in text):
        return text
    out = []
    for c in text:
        point = ord(c)
        if point > 0xFFFF:
            point -= 0x10000
            out.append(chr(0xD800 + (point >> 10)))
            out.append(chr(0xDC00 + (point & 0x3FF)))
        else:
            out.append(c)
    return "".join(out)


def from_js(text):
    """Join surrogate pairs back into characters; a lone half stays as it is."""
    return text.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass")


def js_trim(text):
    start, end = 0, len(text)
    while start < end and text[start] in _WS_CHARS:
        start += 1
    while end > start and text[end - 1] in _WS_CHARS:
        end -= 1
    return text[start:end]


def js_trim_end(text):
    end = len(text)
    while end > 0 and text[end - 1] in _WS_CHARS:
        end -= 1
    return text[:end]


def _canon(ch):
    # ECMA-262 Canonicalize for /i without /u: upper-case it, unless that takes
    # more than one unit or maps a non-ASCII character onto ASCII.
    upper = ch.upper()
    if len(upper) != 1:
        return ch
    if ord(ch) >= 128 and ord(upper) < 128:
        return ch
    return upper


def _variants(ch):
    seen, todo = {ch}, [ch]
    while todo:
        c = todo.pop()
        for d in (c.upper(), c.lower()):
            if len(d) == 1 and d not in seen and _canon(d) == _canon(ch):
                seen.add(d)
                todo.append(d)
    return seen


def _class_char(ch):
    return "\\" + ch if ch in "\\]^-[" else ch


def _read_escape(src, i):
    """One escape at src[i] == '\\'. Returns (kind, value, next_index)."""
    nxt = src[i + 1]
    if nxt == "u" and re.fullmatch(r"[0-9a-fA-F]{4}", src[i + 2:i + 6] or ""):
        return "char", chr(int(src[i + 2:i + 6], 16)), i + 6
    if nxt == "x" and re.fullmatch(r"[0-9a-fA-F]{2}", src[i + 2:i + 4] or ""):
        return "char", chr(int(src[i + 2:i + 4], 16)), i + 4
    simple = {"n": "\n", "r": "\r", "t": "\t", "f": "\x0c", "v": "\x0b", "0": "\x00"}
    if nxt in simple:
        return "char", simple[nxt], i + 2
    if nxt in "sSdDwWbB":
        return "class", nxt, i + 2
    if nxt.isdigit():
        return "backref", nxt, i + 2
    return "char", nxt, i + 2


def js_regex(source, flags=""):
    """Compile a JS regex literal's source into a Python pattern V8 would agree with."""
    source = to_js(source)
    fold = "i" in flags
    multiline = "m" in flags
    out, i = [], 0
    while i < len(source):
        c = source[i]
        if c == "\\":
            kind, value, i = _read_escape(source, i)
            if kind == "class":
                out.append({"s": f"[{WS}]", "S": f"[^{WS}]", "d": "[0-9]", "D": "[^0-9]",
                            "w": f"[{WORD}]", "W": f"[^{WORD}]",
                            "b": BOUNDARY, "B": NOT_BOUNDARY}[value])
            elif kind == "backref":
                if fold:
                    raise ValueError("a backreference under /i folds case in JS; expand it by hand")
                out.append("\\" + value)
            else:
                out.append(_literal(value, fold))
            continue
        if c == "[":
            text, i = _char_class(source, i, fold)
            out.append(text)
            continue
        if c == ".":
            out.append(f"[^{LINE_END}]")
        elif c == "^":
            out.append(f"(?<![^{LINE_END}])" if multiline else r"\A")
        elif c == "$":
            out.append(f"(?![^{LINE_END}])" if multiline else r"\Z")
        elif c == "(" and source.startswith("(?", i):
            # Group syntax passes through whole: (?: (?= (?! (?<= (?<!
            for opener in ("(?<=", "(?<!", "(?:", "(?=", "(?!"):
                if source.startswith(opener, i):
                    out.append(opener)
                    i += len(opener)
                    break
            else:
                raise ValueError(f"unsupported group at {i} in {source!r}")
            continue
        elif c in "()|?*+{}":
            out.append(c)
        else:
            out.append(_literal(c, fold))
        i += 1
    return re.compile("".join(out))


def _literal(ch, fold):
    options = _variants(ch) if fold else {ch}
    if len(options) == 1:
        return re.escape(ch)
    return "[" + "".join(_class_char(o) for o in sorted(options)) + "]"


def _char_class(source, i, fold):
    i += 1
    negated = source.startswith("^", i)
    if negated:
        i += 1
    singles, ranges, extra = [], [], []
    has_s = has_not_s = False
    while i < len(source) and source[i] != "]":
        if source[i] == "\\":
            kind, value, i = _read_escape(source, i)
            if kind == "class":
                if value == "s":
                    has_s = True
                    extra.append(WS)
                elif value == "S":
                    has_not_s = True
                elif value == "d":
                    ranges.append(("0", "9"))
                elif value == "w":
                    extra.append(WORD)
                elif value == "b":
                    singles.append("\x08")
                else:
                    raise ValueError(f"\\{value} inside a class is not supported")
                continue
            low = value
        else:
            low = source[i]
            i += 1
        if source.startswith("-", i) and i + 1 < len(source) and source[i + 1] != "]":
            if source[i + 1] == "\\":
                kind, high, i = _read_escape(source, i + 1)
                if kind != "char":
                    raise ValueError("a class shorthand cannot end a range")
            else:
                high = source[i + 1]
                i += 2
            ranges.append((low, high))
        else:
            singles.append(low)
    i += 1  # the closing ]
    if has_not_s:
        if negated or not has_s:
            raise ValueError("only [\\s\\S] is supported with \\S")
        return r"[\s\S]", i
    if fold:
        folded = []
        for ch in singles:
            folded.extend(_variants(ch))
        for low, high in ranges:
            for point in range(ord(low), ord(high) + 1):
                folded.extend(v for v in _variants(chr(point)) if v != chr(point))
        singles = folded
    body = "".join(extra)
    body += "".join(f"{_class_char(lo)}-{_class_char(hi)}" for lo, hi in ranges)
    body += "".join(_class_char(ch) for ch in dict.fromkeys(singles))
    return ("[^" if negated else "[") + body + "]", i


def js_parse_int(digits, radix):
    """parseInt on the leading run of valid digits; None for NaN, inf past 1.8e308."""
    valid = "0123456789abcdef"[:radix]
    n = 0
    while n < len(digits) and digits[n].lower() in valid:
        n += 1
    if n == 0:
        return None
    value = int(digits[:n], radix)
    try:
        float(value)
    except OverflowError:
        return float("inf")
    return value


# --- reply-intent.ts -------------------------------------------------------

KINDS = ("bounce", "new_address", "referral", "form", "deck", "question", "later", "pass",
         "interested", "unsubscribe", "ignore", "unclear")
# Kinds that never need Jonah: zeutara-gtme's autopilot resends, follows up,
# blocklists or just logs them. Interested, questions, deck requests, forms
# and anything unclear still reach him.
AUTO_HANDLED = frozenset(("bounce", "pass", "later", "new_address", "referral", "unsubscribe",
                          "ignore"))

# Chewbacca's one addition to the upstream rules. Run over Zeutara's 65 real
# replies on 2026-10-10, both delivery failures in the inbox ("Address not
# found", "Message blocked") came out "unclear" and would have reached the
# client as work. The reply guide already rules a bounce has nobody to answer.
# Matched on the mail server's own wording only, never a person's.
BOUNCE = js_regex(
    r"(address not found|wasn'?t delivered|message (was )?blocked|undeliverable|"
    r"delivery (status notification|has failed|failure)|mail delivery (subsystem|failed)|"
    r"could not be delivered|recipient address rejected|mailbox (unavailable|not found|full))", "i")

MAX_INPUT = 6000
FREE_MAIL = js_regex(r"^(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|aol|proton|protonmail)\.", "i")
MAX_LISTED = 6
# Bounded on both sides of the @: the unbounded form backtracks
# quadratically on a long run of "a.a.a." (1.6s on 6000 chars, measured
# 2026-10-09), which a reply can be made to contain.
EMAIL = js_regex(r"[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}", "gi")
URL = js_regex(r"""https?:\/\/[^\s<>()\]"']+""", "gi")
TRAILING_PUNCT = js_regex(r"[.,;]+$")

THREAD_CUT = js_regex(r"\n\s*(On [\s\S]{4,200}?\bwrote:|-{2,}\s*Original Message|From: .+\n)", "i")
SIGN_OFF = js_regex(
    r"^(--\s*$|(kind |best |warm )?regards|best,?$|cheers|sincerely|mit freundlichen|freundliche gr"
    r"|cordialement|this e-?mail (has been|and any|is (intended|confidential|for the)|may)"
    r"|confidential|disclaimer|sent (from|via) )", "i")
# "please take us off your distribution list!" came out "unclear" on
# 2026-10-11, so an opt-out could have been emailed again: "us" and the list
# words count too.
UNSUBSCRIBE = js_regex(
    r"\b(unsubscribe|remove (me|us)|take (me|us) off|stop emailing|do not contact|don'?t contact"
    r"|off (your|the) (distribution|mailing|e-?mail) list)\b", "i")
# A removal ask that names someone else: "Remove Daniel" was the whole reply
# from a partner at one firm (2026-10-10), and it came out "unclear". Only a
# reply that OPENS with remove, or asks to remove someone from a list, counts,
# so "we'll remove the cap next round" is still read for what it is.
REMOVE_ASK = js_regex(
    r"^\s*(please\s+)?remove\b(?![^.!?\n]*\?)|\bremove\s+(him|her|them|us|this (person|contact|address))\b"
    r"|\bremove\s+[^.!?\n]{1,60}\bfrom (your|the|this) (list|database|mailing|distribution|outreach)", "i")
# Mail we must not answer: spam-filter challenges, and a firm's notice that
# its partner died (one firm, 2026-10-06). Redirecting a pitch off a
# death notice is not something to automate.
IGNORE = js_regex(
    r"(verify that the message you sent is not unsolicited|this email is to verify"
    r"|passing of|passed away|in memoriam)", "i")
NEW_ADDRESS = js_regex(
    r"(new|updated|different) (e-?mail|address)|send all correspondence|my new e-?mail"
    r"|address future (communication|correspondence|emails?)|will soon cease to function"
    r"|completed the transition to", "i")
# Auto-replies: English, plus the French and German ones Qube's Swiss and
# Belgian investors sent on 2026-10-06.
OUT_OF_OFFICE = js_regex(
    "(out of (the )?office|traveling|travelling|on (leave|vacation|holiday)"
    "|limited access to e-?mail|checking e-?mails? infrequently|je suis absent|abwesend"
    "|nicht im haus|wieder im b(\u00fc|u)ro|automatic reply|auto-?reply|out today|slow to respond"
    # "Hey! ... This is an automated message. I get a high volume of messages"
    # read as "unclear" on 2026-10-11.
    "|this is an automated (message|response|reply))", "i")
LENDER = js_regex(r"\b(lender|lending|debt financing|venture debt|credit facility)\b", "i")
MOVED_ON = js_regex(
    r"(i'?ve left|i have left|no longer (with|at|monitor|active)|nicht mehr aktiv|has retired from"
    r"|please contact|please direct all|please email|reach out to office|has (now )?taken over"
    r"|is (now )?the best person|best person to (reach|contact)|reach out to (him|her|them|anyone)"
    r"|feel free to reach out to|is more on the|\(cc'?d\)|cc'?ing|looping in)", "i")
FORM = js_regex(
    r"(intake form|founder form|application|apply (through|via|on|at)|submit (your|the|a|it|their)"
    r"|fill (out|in)|our website|investment criteria|typeform|airtable|vettable|portal"
    r"|form (at|here|below|link))", "i")
# "More information" alone is a signature line ("for more information please
# visit mimecast.com" read as a deck request on 2026-10-09), so it needs a
# verb asking for it.
DECK = js_regex(
    r"\bdeck\b|(send|share) (me |us )?(over )?(the |a |your |some )?"
    r"(one[- ]pager|more (info|information|details)|materials|numbers)", "i")
LATER = js_regex(
    r"(back (on|in|after)|in (\d+|a few|two|three|four) weeks|circle back|reach out when"
    r"|after the holidays|next quarter|ball (is )?in my court)", "i")
# A bare "no" (the whole reply, no punctuation) and "It would be a conflict of
# interest since we have our own" both came out "unclear" on 2026-10-11.
PASS = js_regex(
    r"(^\s*no\b([,.!]|\s*$)|\bno interest\b|conflict of interest|(doesn'?t|isn'?t|not)\b[^.]{0,20}\bfit\b|retired from (making )?(new )?invest"
    r"|retired from investing|^\s*no thank|no thank you|not (an )?area of (focus|interest)|pass on"
    r"|outside (of )?our (investment\s*)?(scope|focus|thesis|mandate)"
    r"|don'?t do (consumer|b2c|crypto|hardware|pre-?seed|seed|safes)|bow out|is tough for us"
    r"|going to pass|will pass|not for us|not a fit|no(t)? (a )?fit for us|we('ll| will)? pass"
    r"|passing on|not for us|don'?t do safes|do not do safes|we don'?t invest|not investing"
    r"|outside (of )?our (focus|thesis|mandate)|only (consider|back|invest)|not (the )?right time"
    r"|don'?t think a call makes sense)", "i")
QUESTION_TOPIC = js_regex(
    r"(revenue|arr\b|traction|valuation|raising|round|terms|cap table|burn|runway|users|customers"
    r"|ltm|ntm|how much|metrics)", "i")
INTERESTED = js_regex(
    r"(interested|happy to (chat|take a look|connect|meet)|let'?s (set up|schedule|find)"
    r"|would love|open to (a )?(call|chat)|send me (a )?time|calendly)", "i")
WEEKS = js_regex(r"(\d+|two|three|four) weeks")
BACK_ON = js_regex(r"(until|du|bis|through|thru|back on|return(ing)? on)\s+([^.\n]{3,40})", "i")
FORM_LINK = js_regex(r"form|apply|submit|intake|typeform|airtable|criteria|vettable", "i")
WHITESPACE_RUN = js_regex(r"\s+", "g")


def _emails_in(text, exclude):
    skip = {e.lower() for e in exclude if e}
    seen = {}
    for match in EMAIL.findall(text):
        email = TRAILING_PUNCT.sub("", match.lower(), count=1)
        if email not in skip:
            seen[email] = True
    return list(seen)


def _urls_in(text):
    return list(dict.fromkeys(TRAILING_PUNCT.sub("", u, count=1) for u in URL.findall(text)))


def _domain_of(email):
    parts = email.split("@")
    return (parts[1] if len(parts) > 1 else "").lower()


def _own_words(text):
    """The reply without the quoted thread under it, so our own outbound (which
    mentions decks, raises and links) can't decide the label."""
    # Outlook and Gmail wrap "On <date>, <name> <address> wrote:" across lines
    # (an investor's reply, 2026-10-08), so the match spans newlines.
    found = THREAD_CUT.search(text)
    cut = found.start() if found else -1
    body = text[:cut] if cut > 0 else text
    lines = [line for line in body.replace("\u00a0", " ").replace("\r", "").split("\n")
             if not js_trim(line).startswith(">")]
    # Stop at the sign-off or legal footer. A Zurich law firm's "No, txs" read
    # as a referral on 2026-10-09 because its disclaimer says "please contact
    # us immediately".
    end = next((i for i, line in enumerate(lines) if i > 0 and SIGN_OFF.search(js_trim(line))), -1)
    # Joined on spaces so a phrase the mail client wrapped ("nicht / mehr
    # aktiv") still matches.
    return WHITESPACE_RUN.sub(" ", " ".join(lines[:end] if end > 0 else lines))


def reply_intent(reply_text, lead_email=None, sending_email=None, company_name=None):
    """replyIntent(): the kind of reply and the one thing to do next."""
    result = _reply_intent(to_js(reply_text or ""), to_js(lead_email or ""),
                           to_js(sending_email or ""), company_name and to_js(company_name))
    return {k: ([from_js(a) for a in v] if isinstance(v, list) else from_js(v))
            for k, v in result.items()}


def _reply_intent(reply_text, lead_email, sending_email, company_name):
    # Bounded before any regex runs: the email and URL patterns backtrack
    # polynomially on long runs without a match, and a reply's own words are
    # never this long. Only the quoted thread and footers are.
    text = _own_words(reply_text[:MAX_INPUT])
    lead_email = lead_email.lower()
    company = company_name or "the company"
    others = _emails_in(text, [lead_email, sending_email])
    links = _urls_in(text)

    # An opt-out wins over every other reading: "remove me, my mailbox is full
    # of these" must be blocklisted, not filed as a bounce (togari-platform #78).
    if UNSUBSCRIBE.search(text) or REMOVE_ASK.search(text):
        return {"kind": "unsubscribe", "label": "Asked to unsubscribe",
                "nextStep": "Blocklisted. Never email them again."}

    if BOUNCE.search(text[:400]):
        return {"kind": "bounce", "label": "Didn't deliver",
                "nextStep": "Mark the address bad and never resend to it. Nobody to answer."}

    if IGNORE.search(text):
        return {"kind": "ignore", "label": "No action", "nextStep": "Leave it. Nothing to send."}

    if NEW_ADDRESS.search(text):
        return {"kind": "new_address", "label": "New email address", "addresses": others[:1],
                "nextStep": f"Resend the original email to {others[0]}." if others
                else "Resend the original email to the new address in their reply."}

    if LENDER.search(text):
        return {"kind": "pass", "label": "Lender, not an equity investor",
                "nextStep": "No reply needed. Zeutara isn't raising debt, so it's logged as replied."}

    if OUT_OF_OFFICE.search(text):
        # A person, not an autoresponder, saying when to come back: one investor
        # wrote "traveling internationally for next 3 weeks. Ball in my court."
        weeks = WEEKS.search(text.lower())
        if weeks:
            return {"kind": "later", "label": "Come back later",
                    "nextStep": f"Follow up in {weeks.group(1)} weeks, like they asked."}
        back = BACK_ON.search(text)
        return {"kind": "later", "label": "Out of office",
                "nextStep": f"Auto-reply. Follow up once they're back ({js_trim(back.group(3))})."
                if back else "Auto-reply. Follow up once they're back."}

    if MOVED_ON.search(text):
        # A personal address in a "left the firm" note is for personal matters
        # (two firms, 2026-10-08), never for the pitch.
        firm = [e for e in others if not FREE_MAIL.search(_domain_of(e))]
        if firm:
            more = f" and {len(firm) - MAX_LISTED} more" if len(firm) > MAX_LISTED else ""
            step = (f"Send the same email to {', '.join(firm[:MAX_LISTED])}{more}"
                    " and mention who pointed us to them.")
        else:
            step = "Send the same email to the person they named and mention who pointed us to them."
        return {"kind": "referral", "label": "Pointed us to someone else",
                "addresses": firm[:MAX_LISTED], "nextStep": step}

    if FORM.search(text):
        # A bare link to their own homepage is usually the signature; prefer one
        # that looks like a form.
        form_link = (next((u for u in links if FORM_LINK.search(u)), None)
                     or next((u for u in links
                              if not lead_email or _domain_of(lead_email) not in u.lower()), None)
                     or (links[0] if links else None))
        return {"kind": "form", "label": "Wants a form filled out",
                "nextStep": f"Fill out their form as Jonah with {company}'s details: {form_link}"
                if form_link else f"Fill out the form on their website as Jonah with {company}'s details."}

    if DECK.search(text):
        return {"kind": "deck", "label": "Wants the deck",
                "nextStep": f"Send the {company} deck, then offer a call with the founder."}

    if LATER.search(text):
        weeks = WEEKS.search(text.lower())
        return {"kind": "later", "label": "Come back later",
                "nextStep": f"Follow up in {weeks.group(1)} weeks, like they asked." if weeks
                else "Follow up when they said they'd be back."}

    if PASS.search(text):
        return {"kind": "pass", "label": "Passed", "nextStep": "No reply needed. Logged as replied."}

    if "?" in text and QUESTION_TOPIC.search(text):
        return {"kind": "question", "label": "Asked a question",
                "nextStep": "Answer it in Jonah's words, then offer a call with the founder."}

    if INTERESTED.search(text):
        return {"kind": "interested", "label": "Interested", "nextStep": "Book the call with the founder."}

    return {"kind": "unclear", "label": "Needs a read", "nextStep": "Read their reply and decide."}


# --- reply-text.ts ---------------------------------------------------------

# Named and numeric HTML entities, enough for real-world email bodies.
NAMED_ENTITIES = {
    "amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'", "nbsp": " ",
    "ndash": "-", "mdash": "-", "hellip": "\u2026", "ldquo": '"', "rdquo": '"',
    "lsquo": "'", "rsquo": "'", "middot": "\u00b7", "bull": "\u00b7",
}
ENTITY = js_regex(r"&(#x?[0-9a-f]+|[a-z]+);", "gi")
# Tag bodies are [^<>], not upstream's [^>]: with [^>] every "<" in a run of
# "<br<br<br..." scanned to the end of the text looking for ">", so 20k chars
# took 106 ms and 50k took 2.6 s (GTM tab, 2026-10-10). A "<" inside a tag is
# malformed HTML, so stopping there changes nothing a real email sends.
LOOKS_HTML = js_regex(r"<(html|body|div|p|br|table|span|blockquote|a|meta)\b[^<>]*>", "i")
# <style>/<script>/<head> carry no reply text, only noise. Upstream writes this
# as one pattern with a backreference; JS folds case on a backreference under
# /i and Python does not, so each tag gets its own pattern. Each runs only when
# its closing tag is present, or every unclosed opener would scan to the end.
NOISE_TAGS = tuple((tag, js_regex(fr"<{tag}\b[^<>]*>[\s\S]*?<\/{tag}>", "i"))
                   for tag in ("style", "script", "head"))
BLOCKQUOTE_TAIL = js_regex(r"<blockquote\b[\s\S]*$", "i")
BR = js_regex(r"<br\b[^<>]*>", "gi")
CLOSE_BLOCK = js_regex(r"<\/(p|div|tr|li|h[1-6]|blockquote)\s*>", "gi")
OPEN_BLOCK = js_regex(r"<(p|div|tr|li|h[1-6])\b[^<>]*>", "gi")
ANY_TAG = js_regex(r"<[^<>]+>", "g")
THREAD_MARKERS = (
    # "On Sep 2, 2026, at 2:23 PM, Sagar Tiwari <sagar@...> wrote:"
    js_regex(r"^\s*On\s.{0,120}?\s(?:wrote|schrieb):", "im"),
    # Outlook / Gmail block headers
    js_regex(r"^\s*-{2,}\s*Original Message\s*-{2,}", "im"),
    js_regex(r"^\s*_{5,}\s*$", "m"),
    js_regex(r"^\s*From:\s.+\n\s*Sent:\s", "im"),
    # Confidentiality boilerplate, long and never useful for drafting
    js_regex(r"\b(?:Confidentiality\s+Notice|CONFIDENTIALITY\s+NOTICE)\b"),
    js_regex(r"\bThe information contained in this (?:electronic )?e-?mail\b", "i"),
)
CRLF = js_regex(r"\r\n?", "g")
SPACE_RUN = js_regex(r"[ \t]+", "g")
BLANK_RUN = js_regex(r"\n{3,}", "g")
DASH_PUNCT = js_regex("\\s+[\u2014\u2013]\\s+", "g")
DASH_ANY = js_regex("[\u2014\u2013]", "g")
DOUBLE_COMMA = js_regex(r",\s*,", "g")
SPACE_COMMA = js_regex(r"\s+,", "g")


def _decode_entities_once(text):
    def one(match):
        token = match.group(1).lower()
        if token.startswith("#"):
            code = js_parse_int(token[2:], 16) if token.startswith("#x") else js_parse_int(token[1:], 10)
            if code is None or code == float("inf"):
                return match.group(0)
            if code > 0x10FFFF:
                # String.fromCodePoint throws RangeError here, and so does upstream.
                raise ValueError(f"Invalid code point {code}")
            return to_js(chr(code))
        return NAMED_ENTITIES.get(token, match.group(0))
    return ENTITY.sub(one, text)


def _decode_entities(text):
    # Decode repeatedly, because real mail is double-encoded: the 2026-09-02
    # payload carried "&amp;nbsp;", which one pass leaves as the literal text
    # "&nbsp;". Bounded so a pathological body cannot spin.
    for _ in range(3):
        decoded = _decode_entities_once(text)
        if decoded == text:
            break
        text = decoded
    return text


def _quoted_thread_index(text):
    earliest = -1
    for marker in THREAD_MARKERS:
        found = marker.search(text)
        if found and (earliest == -1 or found.start() < earliest):
            earliest = found.start()
    return earliest


# Upstream runs these regexes on whatever arrives. "\s*\[" scans a whitespace
# run once per start position, so 200,000 spaces then "x" took readable_reply
# 192s (measured 2026-10-09). Real mail with its HTML and quoted thread still
# fits: the longest Zeutara reply on file was under 20k characters.
MAX_CLEAN_INPUT = 50000


def clean_reply_text(raw):
    """cleanReplyText(): reduce an inbound reply to the plain text a human typed."""
    if not raw:
        return ""
    text = to_js(str(raw))[:MAX_CLEAN_INPUT]
    if LOOKS_HTML.search(text):
        lowered = text.lower()
        for tag, pattern in NOISE_TAGS:
            if f"</{tag}" in lowered:
                text = pattern.sub(" ", text)
        # A quoted thread inside a <blockquote> is the common Apple Mail shape.
        text = BLOCKQUOTE_TAIL.sub(" ", text, count=1)
        # Structural tags become line breaks so paragraphs survive.
        text = BR.sub("\n", text)
        text = CLOSE_BLOCK.sub("\n", text)
        text = OPEN_BLOCK.sub("\n", text)
        text = ANY_TAG.sub("", text)
    text = _decode_entities(text)
    cut = _quoted_thread_index(text)
    if cut > 0:
        text = text[:cut]
    text = CRLF.sub("\n", text.replace("\u00a0", " "))
    text = "\n".join(js_trim(SPACE_RUN.sub(" ", line)) for line in text.split("\n"))
    return from_js(js_trim(BLANK_RUN.sub("\n\n", text)))


def strip_em_dashes(text):
    """stripEmDashes(): a punctuating dash becomes a comma, a joining one a hyphen."""
    if not text:
        return ""
    text = DASH_PUNCT.sub(", ", to_js(text))
    text = DASH_ANY.sub("-", text)
    text = DOUBLE_COMMA.sub(",", text)
    return from_js(SPACE_COMMA.sub(",", text))


# --- fit-review.ts ---------------------------------------------------------

# A line where the person has stopped writing: sign-offs, phone footers,
# legal notices, social links. Only looked for after the first line, so a
# one-line "Thanks, no." survives.
SIGNATURE_START = js_regex(
    r"^(--\s*$|regards|best( regards)?[,!]?$|thanks[,!]?$|thank you[,!]?$|cheers[,!]?$|sincerely"
    r"|sent (from|via) |get outlook|\[image|this e-?mail and any attachments|confidential|phone\b"
    "|cell:|tel:|mobile\\b|address\\b|website\\b|linkedin\\b|\U0001d54f)", "i")
# Signature lines the sign-off list misses. One investor's card on
# 2026-10-09 showed a bold name, a phone number, a street address and three
# links under a one-line question: a line that is only a bold name, or that
# carries a link, a phone number or a street address, is where they stopped
# writing.
SIGNATURE_LINE = js_regex(
    r"^\*[^*]{2,60}\*$|https?:\/\/|\bwww\.|\d{3}[-. )]+\d{3}[-. ]+\d{3,4}"
    r"|\d+ [A-Z][a-z]+ (Street|St|Avenue|Ave|Road|Rd|Blvd|Suite)\b")
BRACKET_EMAIL = js_regex(r"(?<!\s)\s*\[(mailto:)?[^\]\s]+@[^\]\s]+\]", "g")
BRACKET_URL = js_regex(r"(?<!\s)\s*\[https?:\/\/[^\]\s]+\]", "g")
PARAGRAPH_BREAK = js_regex(r"\n\s*\n")


def _clip(text, limit):
    return text if len(text) <= limit else js_trim_end(text[:limit - 1]) + "\u2026"


def readable_reply(text, limit=700):
    """readableReply(): signature cut, hard wraps joined, bracketed echoes dropped."""
    lines = to_js(text or "")[:MAX_CLEAN_INPUT].split("\n")
    end = len(lines)
    for i in range(1, len(lines)):
        line = js_trim(lines[i])
        if SIGNATURE_START.search(line) or SIGNATURE_LINE.search(line):
            end = i
            break
    # "person03@firm02.example [person03@firm02.example]" and "<https://...>" echoes
    body = BRACKET_URL.sub("", BRACKET_EMAIL.sub("", "\n".join(lines[:end])))
    paragraphs = [" ".join(t for t in (js_trim(line) for line in p.split("\n")) if t)
                  for p in PARAGRAPH_BREAK.split(body)]
    return from_js(_clip(js_trim("\n\n".join(p for p in paragraphs if p)), limit))


def split_campaign(campaign_name, client_name):
    """splitCampaign(): "Zeutara | Ivy | Pre-seed" -> company Ivy, the rest as detail."""
    parts = [p for p in (js_trim(p) for p in (campaign_name or "").split("|")) if p]
    if len(parts) >= 2 and parts[0].lower() == client_name.lower():
        return {"company": parts[1], "detail": " \u00b7 ".join(parts[2:])}
    return {"company": None, "detail": " \u00b7 ".join(parts)}


# --- auto-send.ts ----------------------------------------------------------

# Long drafts are explaining something, and an explanation is where a wrong
# fact hides. A booking reply is two or three sentences.
MAX_AUTO_DRAFT_CHARS = 900
PROMISES_A_FILE = js_regex(r"\b(attach|attached|attachment|deck|one[- ]pager|data ?room)\b", "i")
BASIC_KINDS = frozenset(("interested", "question", "unclear"))
TEMPLATE_GAP = js_regex(r"[[\]{}]|\bTBD\b|\bXX+\b|<[A-Z_ ]+>")
# The draft is written by a model that read a stranger's email, so a reply can
# steer it. A booking reply needs no link, address, phone number or figure;
# any of those in an unreviewed draft is either a hallucinated fact or text
# someone planted, and it waits for Jonah instead.
CARRIES_PAYLOAD = js_regex(
    r"https?:\/\/|www\.|[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}|\+?\d[\d\s().-]{7,}\d"
    r"|[$\u20ac\u00a3]\s?\d|\d+(\.\d+)?\s?%|\b\d+(\.\d+)?\s?(k|m|mm|bn|million|billion)\b", "i")


def _is_number(value):
    # NaN and infinity pass a plain isinstance check and compare False, so a
    # confidence of NaN would never read as below the threshold.
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value))


def auto_sendable(verdict):
    """autoSendable() with its reasons: every check must pass or Jonah sees the card.

    verdict: {sentiment, confidence, threshold, draft, reply, lead_id,
    campaign_id, lead_email?, sending_email?}. ok is exactly the upstream boolean;
    reasons names every check that failed, not only the first.
    """
    reasons = []
    threshold = verdict.get("threshold")
    if threshold is None:
        reasons.append("no auto-send threshold for this client")
    elif not _is_number(threshold) or not 0 < threshold <= 1:
        reasons.append("auto-send threshold is not a number between 0 and 1")
        threshold = None
    if verdict.get("sentiment") not in ("interested", "wants_more_info"):
        reasons.append("verdict is not interested or wants_more_info")
    confidence = verdict.get("confidence")
    if threshold is not None and (not _is_number(confidence) or confidence < threshold):
        reasons.append("confidence is below the client's threshold")
    draft = js_trim(to_js(verdict.get("draft") or ""))
    if not draft:
        reasons.append("no draft")
    elif len(draft) > MAX_AUTO_DRAFT_CHARS:
        reasons.append(f"draft is over {MAX_AUTO_DRAFT_CHARS} characters")
    if draft and len(draft) <= MAX_AUTO_DRAFT_CHARS:
        if PROMISES_A_FILE.search(draft):
            reasons.append("draft promises a file")
        if TEMPLATE_GAP.search(draft):
            reasons.append("draft has a template gap")
        if CARRIES_PAYLOAD.search(draft):
            reasons.append("draft carries a link, address, number or figure")
    if not verdict.get("lead_id") or not verdict.get("campaign_id"):
        reasons.append("reply is missing the lead or campaign id")
    intent = reply_intent(verdict.get("reply") or "", verdict.get("lead_email"),
                          verdict.get("sending_email"))
    if intent["kind"] not in BASIC_KINDS:
        reasons.append(f"reply reads as {intent['kind']}, which needs Jonah")
    return {"ok": not reasons, "reasons": reasons, "intent": intent["kind"]}


# --- lead-name.ts, card-copy.ts --------------------------------------------

# A list feeder sent every Zeutara name from 10/6 to 10/9 with one stray "e"
# on the end ("Gary Zimmermane" for gary.zimmerman@, 25 of 25 rows), and the
# client read those names on his cards. Strip the "e" only where the evidence
# says it was added: the email spells the name without it, the name ends ".e",
# or the whole feeder is known to add it and the email doesn't show it's theirs.
TRAILING_E = re.compile(r"e$")
NON_ALPHA = re.compile(r"[^a-z]")
WORD_SPLIT = re.compile("[" + WS + "]+")


def clean_lead_name(name, email=None, feeder_adds_e=False):
    """cleanLeadName(): drop a stray trailing "e" a feeder added, nothing else."""
    if not name:
        return name if name is not None else None
    s = js_trim(to_js(name))
    if not TRAILING_E.search(s):
        return from_js(s)
    if s.endswith(".e"):
        return from_js(s[:-1])
    words = WORD_SPLIT.split(s)
    last = words[-1]
    trimmed = last[:-1]
    local = NON_ALPHA.sub("", (email or "").lower().split("@")[0])
    if len(trimmed) >= 3 and trimmed.lower() in local and last.lower() not in local:
        return from_js(" ".join(words[:-1] + [trimmed]))
    if feeder_adds_e and last.lower() not in local:
        return from_js(" ".join(words[:-1] + [trimmed]))
    return from_js(s)


# Real surnames end in "e" about a fifth of the time, so 90% of a batch means
# the feeder added it. Under 8 names is too few to tell. Both from upstream.
FEEDER_E_MIN_NAMES = 8
FEEDER_E_SHARE = 0.9


def feeder_appends_e(recent_names):
    """feederAppendsE(): does nearly every recent name end in "e"."""
    named = [n for n in recent_names if n]
    if len(named) < FEEDER_E_MIN_NAMES:
        return False
    with_e = sum(1 for n in named if TRAILING_E.search(js_trim(to_js(n))))
    return with_e / len(named) >= FEEDER_E_SHARE


AUTO_REPLY = js_regex(
    r"(out of (the )?office|automatic reply|auto-?reply|autoreply|currently out|limited access to "
    r"(my )?e-?mail|on (annual |parental )?leave|away from (my desk|the office)|will (respond|reply|"
    r"get back to you) (when|upon|after) (i|my) return)", "i")


def is_auto_reply(text):
    """isAutoReply(): an out-of-office notice, which never posts as a win."""
    return bool(AUTO_REPLY.search(to_js(text or "")[:MAX_INPUT]))


# --- CLI -------------------------------------------------------------------

def _read_text(path):
    if path in (None, "-"):
        return sys.stdin.buffer.read().decode("utf-8", "replace")
    with open(path, "rb") as handle:
        return handle.read().decode("utf-8", "replace")


def _print(result):
    try:
        text = json.dumps(result, indent=2, ensure_ascii=False)
        text.encode("utf-8")
    except UnicodeEncodeError:
        # A lone surrogate from a numeric entity cannot be UTF-8; escape it.
        text = json.dumps(result, indent=2)
    print(text)


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="gtme-reply",
        description="Read an inbound cold-email reply offline: its intent, its clean "
                    "text, and whether a draft may auto-send. Nothing here reads a mailbox or sends.")
    commands = parser.add_subparsers(dest="command", required=True)

    intent = commands.add_parser(
        "intent", help="what the reply asks for and the one thing to do next",
        description="Classify a reply into one of: " + ", ".join(KINDS) + ". Reads stdin "
                    "unless --file is given. Prints {kind, label, nextStep, addresses?, autoHandled}.")
    intent.add_argument("--file", help="read the reply from this file (- for stdin)")
    intent.add_argument("--lead-email", help="the address that replied, never listed as a new contact")
    intent.add_argument("--sending-email", help="our mailbox, never listed as a new contact")
    intent.add_argument("--company", help="the company being pitched, used in the next step")

    clean = commands.add_parser(
        "clean", help="strip HTML, entities, quoted thread and signature",
        description="cleanReplyText, then readableReply on the result. Reads stdin unless "
                    "--file is given. Prints {text, readable}.")
    clean.add_argument("--file", help="read the reply from this file (- for stdin)")
    clean.add_argument("--max", type=int, default=700, help="readable length cap (default 700)")
    clean.add_argument("--strip-dashes", action="store_true",
                       help="also turn em and en dashes into commas and hyphens")

    autosend = commands.add_parser(
        "autosend", help="may this drafted answer go out with no review",
        description="Reads one JSON object {sentiment, confidence, threshold, draft, reply, "
                    "lead_id, campaign_id, lead_email?, sending_email?} from stdin or --file. "
                    "Prints {ok, reasons, intent}. Exits 0 either way; it decides, it never sends.")
    autosend.add_argument("--file", help="read the JSON from this file (- for stdin)")

    campaign = commands.add_parser(
        "campaign", help="split 'Client | Company | detail' campaign names",
        description="splitCampaign: the company and the rest of a campaign name.")
    campaign.add_argument("name")
    campaign.add_argument("--client", required=True, help="the client the name should start with")

    name = commands.add_parser(
        "name", help="drop a stray trailing 'e' a list feeder added to a lead name",
        description="cleanLeadName. Prints {name, changed}.")
    name.add_argument("name")
    name.add_argument("--email", help="the lead's address, the evidence for the strip")
    name.add_argument("--feeder-adds-e", action="store_true",
                      help="this feeder is known to append 'e' (see the names command)")

    names = commands.add_parser(
        "names", help="does this batch of names show a feeder appending 'e'",
        description="feederAppendsE over one name per line from stdin or --file. "
                    "Prints {feederAddsE, count}.")
    names.add_argument("--file", help="read names from this file (- for stdin)")

    ooo = commands.add_parser(
        "ooo", help="is this reply an out-of-office auto-reply",
        description="isAutoReply. Reads stdin unless --file is given. Prints {autoReply}.")
    ooo.add_argument("--file", help="read the reply from this file (- for stdin)")

    args = parser.parse_args(argv)
    try:
        if args.command == "intent":
            result = reply_intent(_read_text(args.file), args.lead_email, args.sending_email,
                                  args.company)
            result["autoHandled"] = result["kind"] in AUTO_HANDLED
        elif args.command == "clean":
            text = clean_reply_text(_read_text(args.file))
            readable = readable_reply(text, args.max)
            if args.strip_dashes:
                text, readable = strip_em_dashes(text), strip_em_dashes(readable)
            result = {"text": text, "readable": readable}
        elif args.command == "autosend":
            verdict = json.loads(_read_text(args.file))
            if not isinstance(verdict, dict):
                raise ValueError("input must be a JSON object")
            result = auto_sendable(verdict)
        elif args.command == "name":
            cleaned = clean_lead_name(args.name, args.email, args.feeder_adds_e)
            result = {"name": cleaned, "changed": cleaned != args.name.strip()}
        elif args.command == "names":
            batch = [line for line in _read_text(args.file).splitlines() if line.strip()]
            result = {"feederAddsE": feeder_appends_e(batch), "count": len(batch)}
        elif args.command == "ooo":
            result = {"autoReply": is_auto_reply(_read_text(args.file))}
        else:
            result = split_campaign(args.name, args.client)
        _print(result)
        return 0
    except (ValueError, OSError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
