"""The one gate between a Clay crawl and anything written to disk.

Everything clay-map persists (elements.json, the endpoints in routes.json,
package.json) passes through Sanitizer.map / Sanitizer.endpoints right before
it is written. The page library reduces labels too, but this is the rule that
decides what is stored.

Every decision is an exact match against a closed set, never a substring,
prefix or pattern search on the untrusted string:
- Records are rebuilt field by field from fixed name sets. Unknown fields,
  headers, cookies and request values are never copied.
- The vocabulary is clay_ui_words.py: fixed lists of Clay's own UI labels,
  API path segments, request field names and test ids, each kept by hand and
  never extended from crawled data. A label, key, test id or path segment is
  kept only when it equals an entry exactly (a label may also be several
  entries joined by numbers, which become #). Anything else is a placeholder.
- Context beats vocabulary: a column header, a link to a table, workbook,
  campaign, workflow, segment, agent or folder, and a sequence button in the
  inbox always store a typed placeholder ({column_name}, {table_name}, ...),
  even when the name a person typed happens to be a UI word.
- Names the workspace's own CLI listing knows are refused even when they
  equal a vocabulary entry.
- Roles, kinds, dispositions, methods, statuses and reasons come from fixed
  sets.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

# Workspace ids, page labels and the crawl log stay in a cache nothing
# mirrors: ~/.chewbacca/cache is copied into the second-brain repo.
CACHE = Path(os.environ.get("CLAY_PRIVATE_DIR", Path.home() / "Library/Caches/chewbacca-clay"))
PLACEHOLDERS = {"", "<data>", "<per-row>"}
# State ids end in a 6-character opener hash written in letters, so a digit
# run in a committed file always means something leaked.
HASH_LETTERS = str.maketrans("0123456789", "ghijklmnop")
HASH_CHARS = set("0123456789abcdefghijklmnop")

ELEMENT_FIELDS = ("role", "label", "testid", "popup", "template", "instances", "struct", "disposition", "kind", "to",
                  "ms", "quiet_ms", "unlocked", "unlocked_sample", "reason", "requests")
ROLES = {"button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "switch", "checkbox", "radio",
         "combobox", "treeitem", "textarea", "select", "editable", "pointer", "gridcell", "row", "columnheader"}
INPUT_TYPES = {"text", "search", "email", "number", "checkbox", "radio", "button", "submit", "file", "url", "tel", "date",
               "password", "range"}
KINDS = {"page", "tab-url", "menu", "modal", "popover", "panel", "inline", "tooltip", "nothing", "in-place", "write-blocked",
         "document-load", "workspace-switch", "page-outside-workspace", "external", "leaves-clay"}
DISPOSITIONS = {"explored", "link", "external", "gate", "field", "toggle", "chrome", "current-tab", "template-instance",
                "sibling", "unexplored"}
POPUPS = {"menu", "dialog", "listbox", "true", "grid", "tree", "false"}
METHODS = {"GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"}
STATUS_WORDS = {"blocked", "error", "pending"}
STATE_KINDS = {"page", "menu", "modal", "popover", "panel", "inline"}
REASONS = {"gate word", "writes a preference or sends", "typing or toggling writes", "link creates or signs out",
           "per-state cap", "could not return to the state", "element not found on replay",
           "depth cap: what it unlocked is listed, not expanded", "could not reach it", "tried to write",
           "same structure as pressed siblings", "leaves Clay"}
TAGS = {"a", "button", "input", "textarea", "select", "div", "span", "li", "ul", "ol", "tr", "td", "th", "table", "tbody",
        "thead", "nav", "aside", "section", "header", "footer", "main", "form", "label", "p", "h1", "h2", "h3", "h4",
        "details", "summary", "svg", "img", "article", "fieldset", "dialog", "menu", "body"}
SIDEBAR_PARTS = {"sidebar", "content", "group", "group-content", "group-label", "menu", "menu-item", "menu-button",
                 "menu-sub", "menu-sub-item", "menu-sub-button", "header", "footer", "rail", "trigger", "inset"}
STRIP = " ,.:/%()+-–~|·∙"


def _num_fold(s: str) -> str:
    out, digit = [], False
    for i, ch in enumerate(s):
        # A separator between two digits ("4.5", "1,250") stays in the run.
        if digit and ch in ".," and i + 1 < len(s) and s[i + 1].isdigit():
            continue
        if ch.isdigit():
            if not digit:
                out.append("#")
            digit = True
        else:
            out.append(ch)
            digit = False
    return "".join(out)


# Which placeholder a link stores, by the last id segment of its target page.
LINK_NAMES = {"{t}": "{table_name}", "{wb}": "{workbook_name}", "{cam}": "{campaign_name}", "{wf}": "{workflow_name}",
              "{audseg}": "{segment_name}", "{c}": "{agent_name}", "{f}": "{folder_name}", "{gv}": "{view_name}"}


class Sanitizer:
    def __init__(self, vocab: set[str] | None = None, names=()):
        from clay_ui_words import API_KEYS, API_SEGMENTS, APP_ROUTES, TEST_IDS, UI_LABELS
        # A test may pass one small set standing in for all four lists.
        self.vocab = set(vocab) if vocab is not None else set(UI_LABELS)
        self.keys = set(vocab) if vocab is not None else set(API_KEYS)
        self.segments = set(vocab) if vocab is not None else set(API_SEGMENTS) | set(APP_ROUTES)
        self.testids = set(vocab) if vocab is not None else set(TEST_IDS)
        self.base_of: dict[str, str] = {}
        self.names = {str(n).strip().lower() for n in names if n and str(n).strip()}
        self.ids: dict[str, str] = {}
        self._labels: dict[str, str] = {}

    def word(self, s: str) -> bool:
        """Exact membership only."""
        return s in self.vocab and s.lower() not in self.names

    # ---- atoms ----
    def label(self, s) -> str:
        s = " ".join(str(s or "").split())
        if s in PLACEHOLDERS:
            return s
        if s not in self._labels:
            self._labels[s] = self._label(s)
        return self._labels[s]

    def _label(self, s: str) -> str:
        if self.word(s):
            return _num_fold(s)
        # Entries joined by numbers ("Members 5", "20/22 columns"): split at
        # the digit runs; every remaining piece must be an exact entry.
        folded = _num_fold(s)
        if "#" not in folded:
            return "<data>"
        if self.word(folded):  # the fixed list keeps labels with numbers as #
            return folded
        pieces = [p.strip(STRIP) for p in folded.split("#")]
        pieces = [p for p in pieces if p]
        if pieces and all(self.word(p) for p in pieces):
            return folded
        return "<data>"

    def key(self, k) -> str:
        k = str(k or "")
        return k if k in self.keys else "{x}"

    def segment(self, seg: str) -> str:
        if seg == "" or seg in self.segments:
            return seg
        inner = seg[1:-1]
        if len(seg) > 2 and seg[0] == "{" and seg[-1] == "}" and inner.isalpha() and inner.islower():
            return seg
        return "{n}" if seg.isdigit() else "{x}"

    def path(self, p) -> str:
        p = str(p or "")
        for scheme in ("mailto:", "tel:"):
            if p[:len(scheme)].lower() == scheme:
                return scheme
        head, _, query = p.partition("?")
        out = "/".join(self.segment(seg) for seg in head.split("/"))
        tab = ""
        for pair in query.split("&"):
            name, _, value = pair.partition("=")
            if name == "tab" and value in self.segments:
                tab = f"?tab={value}"
        return out + tab

    def role(self, r) -> str:
        r = str(r or "")
        if r in ROLES:
            return r
        name, _, kind = r.partition("-")
        return r if name == "input" and kind in INPUT_TYPES else "other"

    def testid(self, t) -> str:
        t = str(t or "")
        return t if t in self.testids else "{testid}"

    def struct(self, s) -> str:
        parts = []
        for seg in str(s or "").split(">"):
            tag, rest = seg, ""
            for i, ch in enumerate(seg):
                if ch in "[#@":
                    tag, rest = seg[:i], seg[i:]
                    break
            out = tag if tag in TAGS else "el"
            if rest[:1] == "[":
                role, _, rest = rest[1:].partition("]")
                out += f"[{role}]" if role in ROLES else "[other]"
            side = ""
            if rest[:1] == "#":
                testid, _, side = rest[1:].partition("@")
                out += "#" + self.testid(testid)
            elif rest[:1] == "@":
                side = rest[1:]
            if side:
                out += "@" + (side if side in SIDEBAR_PARTS else "other")
            parts.append(out)
        return ">".join(parts)

    def state_id(self, base: str, old_id: str) -> str:
        safe = self.path(base).replace("/workspaces/{ws}", "")
        slug = "-".join(p for p in "".join(ch if ch.isalnum() else "-" for ch in safe).split("-") if p) or "root"
        _, dot, tail = str(old_id).rpartition(".")
        if dot and len(tail) == 6 and set(tail) <= HASH_CHARS:
            slug += "." + tail.translate(HASH_LETTERS)
        return slug

    # ---- records ----
    def request(self, r: dict) -> dict:
        status = r.get("status")
        if not ((isinstance(status, int) and not isinstance(status, bool)) or status in STATUS_WORDS):
            status = None
        ms = r.get("ms")
        ms = ms if isinstance(ms, (int, float)) and not isinstance(ms, bool) else None
        method = str(r.get("method", "")).upper()
        return {"method": method if method in METHODS else "OTHER", "path": self.path(r.get("path")),
                "query": sorted({self.key(k) for k in r.get("query") or []}),
                "body": sorted({self.key(k) for k in r.get("body") or []}), "status": status, "ms": ms}

    def role_label(self, x) -> str:
        role, _, label = str(x).partition(":")
        return self.role(role) + ":" + self.label(label)

    def reason(self, r) -> str:
        r = str(r or "")
        if r in REASONS:
            return r
        # Our own generated forms; the variable parts are dropped, not kept.
        first = r.partition(":")[0]
        if first == "tried to write":
            return "tried to write"  # the blocked calls are in the element's requests
        if r.split(" ")[:3] == ["same", "structure", "as"]:
            return "same structure as pressed siblings"
        return "other"

    def target(self, v) -> str:
        v = str(v)
        if v in self.ids:
            return self.ids[v]
        if v[:1] == "/" or v[:7].lower() == "mailto:" or v[:4].lower() == "tel:":
            return self.path(v)
        return v if v == "see home" or self.word(v) else "<external>"

    def context_label(self, e: dict, state_base: str = "") -> str | None:
        """A typed placeholder when the element's position says its text is a
        name someone gave a thing, whatever the text is."""
        struct = str(e.get("struct", ""))
        if "table-header-field" in struct.split("#", 1)[-1] or e.get("role") == "columnheader":
            return "{column_name}"
        if e.get("disposition") == "link" and e.get("to"):
            target = self.base_of.get(e["to"], "")
            last = [seg for seg in target.split("?")[0].split("/") if seg.startswith("{") and seg != "{ws}"]
            if last and last[-1] in LINK_NAMES:
                return LINK_NAMES[last[-1]]
        if state_base.endswith("/campaigns/inbox") and "@menu-button" in struct:
            return "{sequence_name}"
        return None

    def element(self, e: dict, state_base: str = "") -> dict:
        out = {}
        for f in ELEMENT_FIELDS:
            if f not in e:
                continue
            v = e[f]
            if f == "label":
                v = self.context_label(e, state_base) or self.label(v)
            elif f == "testid":
                v = self.testid(v) if v else ""
            elif f == "struct":
                v = self.struct(v)
            elif f == "role":
                v = self.role(v)
            elif f == "popup":
                v = v if v in POPUPS else ""
            elif f == "kind":
                v = v if v in KINDS else "other"
            elif f == "disposition":
                v = v if v in DISPOSITIONS else "unexplored"
            elif f == "to":
                v = self.target(v)
            elif f in ("ms", "quiet_ms", "unlocked", "instances"):
                v = v if isinstance(v, (int, float)) and not isinstance(v, bool) else None
            elif f == "template":
                v = bool(v)
            elif f == "unlocked_sample":
                v = [self.role_label(x) for x in v][:12] if isinstance(v, list) else None
            elif f == "reason":
                v = self.reason(v)
            elif f == "requests":
                v = [self.request(r) for r in v if isinstance(r, dict)][:40] if isinstance(v, list) else None
            if v not in (None, "", []):
                out[f] = v
        for f in ("role", "label", "struct"):  # always present, even when empty
            out.setdefault(f, "")
        out.setdefault("disposition", "unexplored")
        return out

    def chain_key(self, key) -> str:
        struct, _, tail = str(key or "").rpartition("|")
        if "table-header-field" in struct:
            return self.struct(struct) + "|{column_name}"
        safe_tail = self.label(tail)
        if safe_tail == "<data>" and self.testid(tail) != "{testid}":
            safe_tail = self.testid(tail)
        return self.struct(struct) + "|" + safe_tail

    def map(self, m: dict) -> dict:
        self.ids = {sid: self.state_id(st.get("base", ""), sid) for sid, st in m["states"].items()}
        self.base_of = {sid: str(st.get("base", "")) for sid, st in m["states"].items()}
        self.base_of.update({self.ids[sid]: str(st.get("base", "")) for sid, st in m["states"].items()})
        states = {}
        for sid, st in m["states"].items():
            new = self.ids[sid]
            states[new] = {
                "id": new, "base": self.path(st.get("base")),
                "kind": st.get("kind") if st.get("kind") in STATE_KINDS else "panel",
                "redirects_to": self.path(st["redirects_to"]) if st.get("redirects_to") else None,
                "chain": [{"role": self.role(c.get("role")),
                           "label": self.context_label({"struct": str(c.get("key", "")).rpartition("|")[0],
                                                        "role": c.get("role")}, str(st.get("base", "")))
                           or self.label(c.get("label")),
                           "key": self.chain_key(c.get("key"))} for c in st.get("chain", []) if isinstance(c, dict)],
                "reached": bool(st.get("reached")),
                "load_requests": [self.request(r) for r in st.get("load_requests") or [] if isinstance(r, dict)][:60],
                "elements": [self.element(e, str(st.get("base", ""))) for e in st.get("elements", []) if isinstance(e, dict)],
            }
        raw_cov = m.get("coverage") or {}
        cov = {k: v for k, v in raw_cov.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
        cov["unexplored_list"] = [
            {"state": self.ids.get(u.get("state"), "other"),
             "element": "(whole state)" if u.get("element") == "(whole state)" else self.role_label(u.get("element", "")),
             "why": self.reason(u.get("why", ""))}
            for u in raw_cov.get("unexplored_list", []) if isinstance(u, dict)][:400]
        rev = str(m.get("revision", ""))
        return {"schema": "clay-elements/1", "revision": rev[:12] if set(rev) <= set("0123456789-.") else "",
                "observed": "Crawled read-only behind clay_guard.js and written through clay_sanitize.py. Labels are "
                            "exact matches to string literals in Clay's public JavaScript; anything else is <data> or <per-row>.",
                "coverage": cov,
                "hop_ms": {self.path(k): v for k, v in (m.get("hop_ms") or {}).items()
                           if isinstance(v, (int, float)) and not isinstance(v, bool)},
                "states": states}

    def endpoints(self, eps: dict) -> dict:
        out = {}
        for ep in eps.values():
            if not isinstance(ep, dict):
                continue
            r = self.request(ep)
            ms = ep.get("ms_p50")
            cur = out.setdefault(f"{r['method']} {r['path']}", {
                "method": r["method"], "path": r["path"], "query": [], "body": [], "statuses": [],
                "ms_p50": ms if isinstance(ms, (int, float)) and not isinstance(ms, bool) else None,
                "fired_by": [], "blocked_by_guard": ep.get("blocked_by_guard") is True})
            cur["query"] = sorted(set(cur["query"]) | set(r["query"]))
            cur["body"] = sorted(set(cur["body"]) | set(r["body"]))
            for s in ep.get("statuses", []):
                s = s if (isinstance(s, int) and not isinstance(s, bool)) or s in STATUS_WORDS else None
                if s not in cur["statuses"]:
                    cur["statuses"].append(s)
            for who in ep.get("fired_by", []):
                sid, sep, el = str(who).partition(" :: ")
                suffix = " (page load)"
                load = sid[-len(suffix):] == suffix
                sid = sid[:-len(suffix)] if load else sid
                # Already-sanitized ids map to themselves on a re-scrub.
                state = self.ids.get(sid) or (sid if sid in self.ids.values() else "other")
                safe = state + (suffix if load else "") + (" :: " + self.role_label(el) if sep else "")
                if safe not in cur["fired_by"]:
                    cur["fired_by"].append(safe)
        return dict(sorted(out.items()))


def safe_ref(sid) -> str:
    """A state id for a log line: our own slug and letter hash, nothing else."""
    out = "".join(ch if (ch.isalpha() and ch.islower()) or ch in ".-" else "-" for ch in str(sid))
    return "-".join(p for p in out.split("-") if p)[:80] or "state"


def log_line(msg: str) -> str:
    """Last pass over every line clay-map logs or prints while crawling.
    Callers already pass only state ids, vocabulary labels, kinds, counts and
    timings; this templates anything that still looks like an email, URL,
    Clay object id, uuid or token, and digit runs of six or more."""
    s = str(msg)
    s = re.sub(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", "<email>", s)
    s = re.sub(r"\b(https?://|www\.)\S+|\b(mailto|tel):\S+", "<url>", s, flags=re.I)
    s = re.sub(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", "{uuid}", s, flags=re.I)
    s = re.sub(r"\b([a-z]{1,8})_[A-Za-z0-9]{8,}\b", lambda m: "{" + m.group(1) + "}", s)
    s = re.sub(r"\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b", "<token>", s)
    s = re.sub(r"\d{6,}", "#", s)
    s = re.sub(r"\b(bearer|cookie|authorization)\b", "<redacted>", s, flags=re.I)
    return s.replace("@", "<at>")


def find_leaks(text: str) -> list[str]:
    """A check on the finished file, not the gate: emails, an @ outside the
    struct notation, auth words, digit runs of six or more, Clay object ids."""
    pats = [re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+"), re.compile(r"@(?![a-z\-]+[>\"|])"),
            re.compile(r"\b(bearer|cookie|authorization)\b", re.I), re.compile(r"\d{6,}"),
            re.compile(r"\b(t|wb|cam|wf|gv|audseg|c|f)_[A-Za-z0-9]{10,}\b")]
    hits = []
    for p in pats:
        hits += [m.group(0) for m in p.finditer(text)][:3]
    return hits
