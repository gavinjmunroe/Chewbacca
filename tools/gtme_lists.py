"""What a send list's rows mean, for every client: role mailboxes, free
domains, column names, firm identity and whether an email domain belongs to
its firm.

Moved here from zeutara-gtme scripts/gtm_common.py on 2026-10-13, unchanged,
so the engine's pre-send gate (gtme_presend.py) and a client's list builder
(zeutara-gtme qualify.py, through gtm_common, which now re-exports this file)
cannot drift apart on what a role mailbox or a free domain is. The patterns
were copied from list-gate (~/.local/bin/list-gate) so all three agree.
"""
import csv
import json
import os
import re
import unicodedata

csv.field_size_limit(10**9)

ROLE = re.compile(r"^(info|contact|admin|hello|hi|team|office|support|sales|enquiries|"
                  r"inquiries|general|mail|ir|investor|investorrelations|invest|press|"
                  r"media|careers|jobs|help|noreply|no-reply|accounts|finance|hr|deals|"
                  r"pitch|pitches|submissions|founders|startups)[.@+-]", re.I)
EMAIL_OK = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)
FREE = {"gmail.com", "googlemail.com", "hotmail.com", "yahoo.com", "yahoo.co.in",
        "yahoo.co.uk", "yahoo.com.ph", "rediffmail.com", "mail.ru", "live.com",
        "outlook.com", "aol.com", "icloud.com", "me.com", "mac.com", "msn.com",
        "protonmail.com", "proton.me", "hotmail.co.uk", "gmx.de", "gmx.com", "web.de",
        "qq.com", "163.com", "comcast.net", "verizon.net", "att.net", "sbcglobal.net"}
NULL_ORG = {"", "unknown", "person", "company", "n/a", "na", "none", "-", "null",
            "test", "self", "self-employed", "independent", "private"}
NAN_STRIP = re.compile(r"\b(Ficial|Fice|Ferdez|Herdez)\b")
URLISH = re.compile(r"(https?://|airtable|\.png|\.jpg|www\.)", re.I)
SUFFIX = re.compile(r"\b(llc|ltd|limited|inc|incorporated|llp|lp|plc|pty|gmbh|ag|co|corp|"
                    r"corporation|company|holdings?|group|partners?|capital|ventures?|"
                    r"management|advisors?|fund[s]?|vc|investments?)\b")
STOP = {"the", "and", "of", "for", "de", "la", "&"}

ALIASES = {
    "name": ("fullname", "name", "contactname", "full_name"),
    "email": ("email", "emailaddress", "workemail", "mail", "normalizedemail"),
    "company": ("organization", "company", "companyname", "org", "employer",
                "account", "firm", "cleancompanyname"),
    "title": ("title", "jobtitle", "role", "position"),
    "org_type": ("orgtype", "companytype", "organizationtype", "investortype"),
    "sectors": ("sectors", "sector", "industries", "thesis", "focus"),
    "check_size": ("checksize", "check", "ticket"),
    "evidence": ("evidence", "portfolio", "hookevidence", "portfolioevidence", "notes"),
    "id": ("recordid", "record_id", "rowid", "id", "contactid"),
    # The per-lead "why you" line that names a portfolio company, and the public
    # URL that proves the investment happened.
    "line": ("personalizedcopy", "newpersonalizedcopy", "newline", "whyyouline"),
    "line_source": ("linesource", "linesourceurl", "sourceurl", "evidenceurl"),
    # A real mailbox verdict from a verifier (Clay Validate Email, ZeroBounce,
    # NeverBounce, MillionVerifier, Debounce). Deliberately NOT "email_check":
    # in this repo that column is a domain-vs-firm heuristic, not a verifier.
    "verification": ("emailverification", "verification", "verificationstatus",
                     "emailstatus", "emailvalidation", "validationstatus",
                     "validateemail", "zerobouncestatus", "neverbounceresult",
                     "verifierresult", "deliverability", "emailverified"),
}


def slug(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def detect(fields):
    """Map logical column names to the CSV's actual headers."""
    out = {}
    for key, names in ALIASES.items():
        for col in fields or []:
            if slug(col) in names and col not in out.values():
                out[key] = col
                break
    return out


def read_rows(path):
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)
        return rows, detect(reader.fieldnames or [])


def get(row, cols, key):
    return (row.get(cols.get(key, ""), "") or "").strip()


def ascii_lower(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def firm_key(name):
    """Same normalization as list-gate and allocate.py. Merges surface forms of
    one firm inside our own lists. Never use it to join OUT to Clay: see
    AGENTS.md, normalization is directional."""
    k = re.sub(r"[^a-z0-9 ]", " ", ascii_lower(name))
    stripped = SUFFIX.sub(" ", k)
    return re.sub(r"\s+", " ", stripped if stripped.strip() else k).strip()


def email_domain(email):
    return email.rsplit("@", 1)[-1].lower().strip() if "@" in (email or "") else ""


def load_aliases(path="out/firm-aliases.csv"):
    """alias_key -> canonical_key, plus canonical_key -> domain, from fuse_firms.py."""
    alias, domains = {}, {}
    if not path or not os.path.exists(path):
        return alias, domains
    with open(path, newline="", encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh):
            a, c = (r.get("alias_key") or "").strip(), (r.get("canonical_key") or "").strip()
            if a and c:
                alias[a] = c
            d = (r.get("domain") or "").strip().lower()
            if c and d:
                domains.setdefault(c, set()).add(d)
    return alias, domains


def canonical_firm(name, alias):
    k = firm_key(name)
    return alias.get(k, k)


def domain_matches_firm(domain, firm, known_domains=None):
    """True when the email domain plausibly belongs to the firm.

    The 2026-10-03 Jev pass found 102 of Qube's 481 audience rows had an email
    domain unrelated to the firm (an Accel partner at an unrelated domain, a
    firm name on a gmail address), and those lists bounced 27%. So a mismatch is
    treated as evidence the address is stale or belongs to someone else.
    """
    if not domain or not firm:
        return False
    canon = firm_key(firm)
    if known_domains and domain in known_domains.get(canon, set()):
        return True
    all_words = re.findall(r"[a-z0-9]+", ascii_lower(firm))
    words = [w for w in all_words if w not in STOP]
    if not words:
        return False
    for label in registrable_labels(domain):
        if _label_matches(label, words, all_words):
            return True
    return False


# Second-level labels that sit under a country code, so loveventures.co.uk is
# matched on "loveventures", not on "co". Measured: before this, every .co.uk
# and .com.hk firm in the Qube list was rejected as a mismatch.
SECOND_LEVEL = {"co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc", "or", "ne"}
GENERIC_TAIL = re.compile(r"(ventures?|vc|capital|cap|partners?|fund[s]?|group|holdings?|"
                          r"hq|llc|inc|invest(ments?)?|mgmt|management)$")


def registrable_labels(domain):
    """Every label left of the public suffix: smith.williamson.co.uk gives
    ['smith', 'williamson']."""
    labels = [re.sub(r"[^a-z0-9]", "", x) for x in domain.lower().split(".") if x]
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in SECOND_LEVEL:
        labels = labels[:-2]
    else:
        labels = labels[:-1]
    return [x for x in labels if x]


def _prefix_chain(s, words):
    """Can s be built from non-empty prefixes of the words, in order, skipping
    any? 'impcap' from imprimatur + capital, 'tnyfo' from the new york family
    office. Needs two or more words, or one word giving four or more letters."""
    def walk(i, wi, used, longest):
        if i == len(s):
            return used >= 2 or longest >= 4
        for j in range(wi, len(words)):
            w = words[j]
            n = 0
            while n < len(w) and i + n < len(s) and s[i + n] == w[n]:
                n += 1
            for k in range(n, 0, -1):
                if walk(i + k, j + 1, used + 1, max(longest, k)):
                    return True
        return False
    return len(s) >= 3 and walk(0, 0, 0, 0)


def _label_matches(label, words, all_words):
    if len(label) < 2:
        return False
    if any(len(w) >= 3 and (w in label or (len(label) >= 3 and label in w)) for w in words):
        return True
    joined = "".join(words)
    if len(label) >= 3 and (label in joined or joined in label):
        return True
    core = GENERIC_TAIL.sub("", label) or label
    return _prefix_chain(core, all_words) or _prefix_chain(label, all_words)


def is_real_org(org):
    return (org.lower() not in NULL_ORG and not URLISH.search(org)
            and not NAN_STRIP.search(org))


CONTEXT_BLOCK = re.compile(r"```json qualification\s*\n(.*?)\n```", re.S)


def load_context(company, root="context"):
    """Read the machine-readable block from context/<company>.md.

    One context file per company is the foundation every tool reads (the
    gtm-context pattern from lucaslinares1/gtm-skills, MIT). The prose above the
    block is for people and for copy; the block is what code reads.
    """
    path = os.path.join(root, f"{company}.md")
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    m = CONTEXT_BLOCK.search(text)
    if not m:
        raise ValueError(f"{path} has no ```json qualification block")
    block = json.loads(m.group(1))
    block.setdefault("slug", company)
    return block, path
