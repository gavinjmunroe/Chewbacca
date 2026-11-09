"""Element-level crawl of Clay's UI, read-only, over Browser Harness.

Run by `clay-map crawl` with the jev-ultrafast environment's Python, which
owns browser_harness. Breadth-first from workspace home: every interactive
element in every state is enumerated; every element that is not a gate, a
field or a toggle is pressed once, what it opened is recorded, and the state
is restored before the next one. A state is a page (URL pattern) plus the
chain of openers that produced its open menu, modal, panel or tab.

Two layers keep it read-only. Gate words and deny words refuse a press
before it happens (in Python and again in the page), and clay_guard.js
refuses every non-GET request to api.clay.com that is not a known read. A
press that tried to write anyway is recorded as a gate with the endpoint it
tried.

Nothing personal is written: labels come back from the page already reduced
to Clay's own UI copy (see clay_crawl.js), and concrete URLs, which carry
workspace ids, go to a private cache, never the repository.
"""
from __future__ import annotations

import hashlib
import os
import json
import re
import sys
import time
from collections import deque
from pathlib import Path
from urllib.parse import parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parent))
from clay_sanitize import KINDS  # noqa: E402

try:  # absent outside the jev-ultrafast environment; the pure helpers still import
    from browser_harness.admin import ensure_daemon
    from browser_harness.helpers import cdp
except ImportError:  # pragma: no cover
    ensure_daemon = cdp = None

HERE = Path(__file__).resolve().parent

# Reads Clay makes with POST, seen on page loads with the guard in log mode
# on 2026-10-09 (32 pages, no clicks). Everything else non-GET is refused.
READ_POSTS = [
    r"/resources_v2/$", r"/resources/<id>/activity$", r"/audiences/count$", r"/audiences/[A-Z]+/signals$",
    r"/audiences/(contacts|companies)$", r"/clay-sequencer/analytics/", r"/clay-sequencer/master-inbox/(replies|message-history)$",
]
# Labels that write without one of the routes.json gate words: preferences,
# favorites, view filters, canvas layout, AI chat prompts, help widgets.
DENY = ("favorite|favourite|unfavorite|dismiss|switch to|clear|clear chip|auto-arrange|role for|summarize|suggest|why are|"
        "attach|scroll to latest|mark|assign|move|apply|set as|enable|disable|connect|disconnect|unsubscribe|approve|"
        "reject|schedule|accept|decline|empty|log out|help & support|upgrade|book a demo|contact sales|talk to|request|"
        "toggle|show/hide|collapse|filter on|graph view|leave|sign out|ask clay|build with ai|chat|admin tooling|refresh|reset|revert|restore|dock|undock")
# A press waits this long for the screen to change, then for 250 ms of quiet.
# Clay's slowest overlay on 2026-10-09 (the table sidebar) mounted in ~1.2 s.
ACT_MAX_MS = 3000
PRESS_BUDGET_MS = 5000
# Explorable, non-template elements per state before the rest are listed as
# unexplored. The busiest state seen (a campaign's sequence editor) had ~70.
PER_STATE_CAP = 90
# Opener chains: overlays (menus, modals) nest to MAX_CHAIN, panels and tabs
# that keep the page underneath to MAX_PANEL_DEPTH. See classify().
MAX_CHAIN = 3
MAX_PANEL_DEPTH = 2
# Lists of LIST_MIN or more same-structure controls are sampled LIST_SAMPLE deep.
LIST_MIN = 6
LIST_SAMPLE = 2
SKIP_LINK = re.compile(r"/new\b|/create|logout|sign-?out|/chats/|addCredits", re.I)


def pattern(url: str) -> str:
    path, _, q = url.partition("?")
    path = re.sub(r"^https://app\.clay\.com", "", path)
    path = re.sub(r"/workspaces/\d+", "/workspaces/{ws}", path)
    path = re.sub(r"\b([a-z]{1,6})_[A-Za-z0-9]{8,}", lambda m: "{" + m.group(1) + "}", path)
    path = re.sub(r"/\d{3,}", "/{n}", path).rstrip("/")
    tab = parse_qs(q).get("tab")
    return path + (f"?tab={tab[0]}" if tab else "")


def slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", s.replace("/workspaces/{ws}", "")).strip("-") or "root"


def clean_requests(reqs: list[dict]) -> list[dict]:
    """Method, templated path, field names, status, ms. Field names that are
    ids (f_..., t_...) are templated too; no values ever arrive here."""
    out, seen = [], set()
    for r in reqs or []:
        body = sorted({re.sub(r"\b([a-z]{1,8})_[A-Za-z0-9]{8,}", r"{\1}", k) for k in r.get("body") or []})
        q = sorted(set(r.get("query") or []))
        sig = (r["method"], r["path"], tuple(q), tuple(body))
        if sig in seen:
            continue
        seen.add(sig)
        out.append({"method": r["method"], "path": r["path"], "query": q, "body": body, "status": r.get("status"), "ms": r.get("ms")})
    return out


def shape(struct: str) -> str:
    """The structure that identifies a control: the element itself plus every
    ancestor with a role, test id or sidebar part. Plain wrapper divs are
    dropped; the workflow side panel re-wrapped the same fields in a
    different number of them between reads on 2026-10-10, and every pass
    counted them as new."""
    segs = struct.split(">")
    keep = [x for x in segs[:-1] if any(c in x for c in "[#@")]
    return ">".join(keep + segs[-1:])


def ekey(el: dict) -> str:
    tail = el["testid"] or ("<per-row>" if el["template"] else el["label"])
    return shape(el["struct"]) + "|" + tail


# Workspace ids, page labels and the crawl log stay in a cache nothing
# mirrors: ~/.chewbacca/cache is copied into the second-brain repo.
PRIVATE = Path(os.environ.get("CLAY_PRIVATE_DIR", Path.home() / "Library/Caches/chewbacca-clay"))
TAB_FILE = PRIVATE / "clay-map-tab.json"
CLAY_ORIGIN = "https://app.clay.com"
OFF_ORIGIN = "__clay_map_off_origin__"


class OffOrigin(RuntimeError):
    """The tab is no longer on app.clay.com; nothing was evaluated there."""


def is_clay_origin(url: str) -> bool:
    """Scheme, host and port exactly https://app.clay.com. A substring, prefix
    or pattern would let app.clay.com.evil.example or evil.example/?app.clay.com
    through."""
    from urllib.parse import urlsplit
    try:
        u = urlsplit(str(url))
        return u.scheme == "https" and u.hostname == "app.clay.com" and u.port in (None, 443) and not u.username \
            and not u.password and u.netloc in ("app.clay.com", "app.clay.com:443")
    except ValueError:
        return False


def own_tab(ws: str) -> str:
    """The crawler's own background tab, reused across runs, never a tab
    someone else opened. On 2026-10-09 a restarted crawl attached to the first
    Clay tab it found, which was not the one it had opened."""
    pages = {t["targetId"]: t for t in cdp("Target.getTargets")["targetInfos"] if t["type"] == "page"}
    try:
        tid = json.loads(TAB_FILE.read_text())["target"]
        if tid in pages and is_clay_origin(pages[tid]["url"]):
            return tid
    except (OSError, ValueError, KeyError):
        pass
    tid = cdp("Target.createTarget", url=f"https://app.clay.com/workspaces/{ws}/home", background=True)["targetId"]
    TAB_FILE.parent.mkdir(parents=True, exist_ok=True)
    TAB_FILE.write_text(json.dumps({"target": tid}))
    time.sleep(6)
    return tid


class Page:
    def __init__(self, ws: str, names: list[str], gate: str, reload: bool = True):
        ensure_daemon()
        self.target = own_tab(ws)
        self.attach(install=False)
        self.ws = ws
        self.guard = (HERE / "clay_guard.js").read_text().strip().rstrip(";")
        self.lib = (HERE / "clay_crawl.js").read_text().strip().rstrip(";")
        self.cfg = {"gate": gate, "deny": DENY, "names": names}
        # Start from a fresh document so no earlier instrumentation or half-open
        # panel survives into the crawl. The one full load of the run.
        if reload:
            cdp("Page.reload", session_id=self.sid, ignoreCache=False)
            time.sleep(6)
        self.install()

    def js(self, expr: str, timeout: float = 20, _retry: bool = True):
        # Every evaluation first checks, in the same call, that the page is
        # still exactly app.clay.com; a press can navigate anywhere.
        guarded = f"(location.origin === {json.dumps(CLAY_ORIGIN)}) ? ({expr}) : {json.dumps(OFF_ORIGIN)}"
        try:
            r = cdp("Runtime.evaluate", session_id=self.sid, expression=guarded, awaitPromise=True, returnByValue=True,
                    _response_timeout=timeout)
        except Exception as exc:
            # On 2026-10-09 the background tab stopped answering mid-crawl and
            # every later state timed out; a reload brought it back. Recover
            # once, then let the caller record the failure.
            if not _retry:
                raise
            if "Session with given id not found" in str(exc) or "-32001" in str(exc):
                # The daemon restarted under us (seen 2026-10-09 when the agent
                # session restarted): attach again to the same tab and retry once.
                self.attach()
                return self.js(expr, timeout, _retry=False)
            if "timed out" not in str(exc):
                raise
            self.recover()
            raise RuntimeError("tab hung and was reloaded: " + str(exc)[:80]) from exc
        if "exceptionDetails" in r:
            raise RuntimeError(json.dumps(r["exceptionDetails"])[:300])
        v = (r.get("result") or {}).get("value")
        if v == OFF_ORIGIN:
            raise OffOrigin("tab left app.clay.com")
        return json.loads(v) if isinstance(v, str) and v[:1] in "{[" else v

    def back_to_clay(self, ws: str) -> None:
        """Navigate the tab back by URL after a press left Clay. Nothing on the
        other page is read or pressed."""
        cdp("Page.navigate", session_id=self.sid, url=f"{CLAY_ORIGIN}/workspaces/{ws}/home", _response_timeout=30)
        time.sleep(6)
        self.install()

    def attach(self, install: bool = True) -> None:
        ensure_daemon()
        self.target = own_tab(self.ws) if hasattr(self, "ws") else self.target
        self.sid = cdp("Target.attachToTarget", targetId=self.target, flatten=True)["sessionId"]
        cdp("Emulation.setFocusEmulationEnabled", session_id=self.sid, enabled=True)
        if install:
            self.install()

    def recover(self) -> None:
        self.hangs = getattr(self, "hangs", 0) + 1
        cdp("Page.reload", session_id=self.sid, _response_timeout=30)
        time.sleep(8)
        self.install()

    def install(self) -> None:
        self.js(f"({self.guard})('strict', {json.dumps(READ_POSTS)})")
        self.js(f"({self.lib})({json.dumps(self.cfg)})")
        if not hasattr(self, "_vocab"):
            # The page reduces labels with the same fixed list the map stores.
            from clay_ui_words import UI_LABELS
            self._vocab = sorted(UI_LABELS)
        # In pieces under 40 KB: the daemon's socket took a 50 KB message and
        # broke on a 100 KB one (measured 2026-10-09).
        self.js("window.__cm.setVocab([])")
        piece, size = [], 0
        for w in self._vocab + [None]:
            if w is None or size + len(json.dumps(w)) > 40_000:
                if piece:
                    self.js(f"window.__cm.addVocab({json.dumps(piece)})", 30)
                piece, size = [], 0
            if w is not None:
                piece.append(w)
                size += len(json.dumps(w)) + 2

    def ensure(self) -> None:
        if not self.js("!!(window.__cm && window.__cm.act && window.__clayGuard && window.__clayGuard.log && window.__clayGuard.mode === 'strict')"):
            self.install()

    def url(self) -> str:
        return self.js("location.pathname + location.search")

    def settle(self, max_ms: int, quiet_ms: int, need_change: bool) -> dict:
        """Done when the DOM has been quiet for quiet_ms AND no api.clay.com
        request the step started is still in flight (network idle, read from
        clay_guard.js's log), or at max_ms. Polled every 25 ms from here, so
        the page does no work while waiting."""
        while True:
            time.sleep(0.025)
            w = self.js("window.__cm.watchPoll()")
            if not w or w.get("gone"):
                return {"first_ms": None, "quiet_ms": 0, "elapsed": 0}
            changed = w["first_ms"] is not None
            idle = w["since_last"] >= quiet_ms and not w["pending"]
            if w["elapsed"] > max_ms or (idle and (changed or not need_change or w["elapsed"] > quiet_ms * 4)):
                return w

    def hop(self, url: str) -> dict:
        """One router hop. ms is when the DOM last changed before 400 ms of
        quiet: Clay's render."""
        self.ensure()
        start = self.js("""((u) => { const g = window.__clayGuard, l0 = g.log.length;
          const pushed = location.pathname + location.search !== u;
          window.__cm.watchStart(null, 0); window.__cm.w.l0 = l0;
          if (pushed) { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate', {state: {}})); }
          return JSON.stringify({l0, pushed}); })(%s)""" % json.dumps(url))
        # Clay's slowest page on 2026-10-09 (People records) settled in ~2.5 s.
        self.settle(6000, 200, False)
        t = self.js("JSON.stringify(window.__cm.watchStop())")
        reqs = self.js(f"JSON.stringify(window.__cm.requests({start['l0']}))")
        return {"pushed": start["pushed"], "ms": t["quiet_ms"], "at": self.url(), "requests": reqs}

    def escape(self, n: int = 2) -> None:
        for _ in range(n):
            self.js("window.__cm.escapeKeys(1)")
            time.sleep(0.05)

class Crawl:
    def __init__(self, page: Page, ws: str, log=print):
        self.p, self.ws = page, ws
        from clay_sanitize import log_line
        # Every line, from any caller, passes the log sanitizer first.
        self.log = lambda msg: log(log_line(msg))
        self.states: dict[str, dict] = {}
        self.urls: dict[str, str] = {}
        self.edges: dict[tuple, dict] = {}
        self.queue: deque[str] = deque()
        self.hop_ms: dict[str, list[int]] = {}
        self.new_found = 0
        self.dirty = True
        self.page_keys: dict[str, list[str]] = {}
        self.checkpoint = None
        self.san = None
        self.retry = 0

    # ---------- states ----------
    @staticmethod
    def state_id(base: str, chain: list[dict]) -> str:
        h = hashlib.sha1(json.dumps([c["key"] for c in chain]).encode()).hexdigest()[:6]
        return slug(base) + ("" if not chain else "." + h.translate(str.maketrans("0123456789", "ghijklmnop")))

    def add_state(self, base: str, chain: list[dict], kind: str, url: str | None = None, marker=None) -> str:
        sid = self.state_id(base, chain)
        if sid not in self.states:
            self.states[sid] = {"id": sid, "base": base, "chain": chain, "kind": kind, "elements": {}, "baseline": [],
                                "overlays": 0, "marker": list(marker or []), "explored": False, "reach_fail": 0}
            self.queue.append(sid)
            self.new_found += 1
            if url and base not in self.urls:
                self.urls[base] = url
        return sid

    def here_matches(self, st: dict) -> bool:
        """Cheap check that the screen is this state: path, overlay count, the
        keys that its opener unlocked, and overall similarity to its baseline."""
        p = self.p
        if self.dirty or pattern(p.url()) != st.get("match", st["base"]) or not st["baseline"]:
            return False
        info = p.js("JSON.stringify({o: window.__cm.overlays().length, k: [...window.__cm.keys(window.__cm.scope())]})")
        if info["o"] != st["overlays"]:
            return False
        now = set(info["k"])
        if st["marker"] and len(now & set(st["marker"])) < max(1, len(st["marker"]) // 2):
            return False
        base = set(st["baseline"])
        return len(now & base) / max(1, len(now | base)) >= 0.8

    def reach(self, sid: str) -> bool:
        st = self.states[sid]
        url = self.urls.get(st["base"])
        if not url:
            return False
        p = self.p
        try:
            p.ensure()
        except OffOrigin:
            p.back_to_clay(self.ws)
            self.dirty = True
        if self.here_matches(st):
            return True
        if not self.dirty and p.js("window.__cm.overlays().length"):
            p.escape(2)
            if self.here_matches(st):
                return True
        # Already on this page with nothing open: replay the openers in place.
        if not self.dirty and st["chain"] and pattern(p.url()) == st.get("match", st["base"]) \
                and not p.js("window.__cm.overlays().length"):
            if all(self.press_desc(c) for c in st["chain"]) and self.opened(st):
                return True
            self.dirty = True
        # Remount through another route so panels opened without an overlay close.
        if pattern(p.url()) == st.get("match", st["base"]):
            p.hop(f"/workspaces/{self.ws}/home")
        r = p.hop(url)
        self.dirty = False
        if r.get("pushed"):
            self.hop_ms.setdefault(st["base"], []).append(r["ms"])
        if not st.get("load_requests"):
            st["load_requests"] = clean_requests(r.get("requests"))
        if pattern(r["at"]) != st.get("match", st["base"]):
            if st["explored"] or st.get("match"):
                return False
            st["match"] = pattern(r["at"])  # a redirect, e.g. /people -> /people/all/records
        for c in st["chain"]:
            res = self.press_desc(c)
            if not res:
                return False
            if res.get("overlays", 0) == 0:
                self.dirty = True  # a panel or tab: only a remount undoes it
        return self.opened(st)

    def opened(self, st: dict) -> bool:
        """After replaying a chain: did the state actually open? At least half
        of the controls its opener unlocked must be on screen. On 2026-10-10 a
        replay that left the panel shut re-read the parent page into the
        panel's state every pass."""
        if not st["chain"] or not st["marker"]:
            return True
        now = set(self.p.js("JSON.stringify([...window.__cm.keys()])") or [])
        return len(now & set(st["marker"])) >= max(1, len(st["marker"]) // 2)

    def press_desc(self, desc: dict) -> dict | None:
        els = self.p.js("JSON.stringify(window.__cm.enum())")
        cand = [e for e in els if e["struct"] == desc["struct"] and (e["testid"] or e["label"]) == desc["tail"]]
        if not cand:
            cand = [e for e in els if e["struct"] == desc["struct"]]
        if not cand:
            return None
        e = cand[min(desc.get("index", 0), len(cand) - 1)] if desc.get("template") else cand[0]
        started = self.p.js(f"window.__cm.actStart({e['i']})")
        if not started or started.get("err"):
            return None
        # Wait for a change, then 250 ms of quiet, and for the requests the
        # press started (1.5 s more at most) so status and ms are known.
        # One budget for change, render and the requests it fired: a press
        # still busy at 5 s is recorded with what it had, not waited on.
        self.p.settle(PRESS_BUDGET_MS, 150, True)
        r = self.p.js("window.__cm.actEnd()")
        return r if r and not r.get("err") else None

    # ---------- exploring ----------
    def log_press(self, sid: str, el: dict, kind: str, to, r: dict) -> None:
        t = r.get("timing") or {}
        first = t.get("first_ms") if isinstance(t.get("first_ms"), (int, float)) else None
        fresh = r.get("fresh_count") if isinstance(r.get("fresh_count"), int) else 0
        self.log(f"  {self.ref(sid)} :: {self.say_label(el)} -> {kind if kind in KINDS else 'other'} {self.ref(to) if to else ''} "
                 f"({first} ms, +{fresh})")

    def log_error(self, sid: str, exc: BaseException) -> None:
        # The exception's class only: its text can carry a URL or page text.
        self.log(f"  error in {self.ref(sid)}: {type(exc).__name__}")

    def sanitizer(self):
        if self.san is None:
            import clay_sanitize
            # The same fixed lists the map is written with.
            self.san = clay_sanitize.Sanitizer(names=getattr(self, "names", ()))
        return self.san

    def say_label(self, el: dict) -> str:
        """role:label for a log line, through the map's own sanitizer."""
        san = self.sanitizer()
        return san.role(el.get("role")) + ":" + san.label(el.get("label", ""))

    def ref(self, sid) -> str:
        """A state for a log line: the id the map itself would store, derived
        from the state's sanitized base pattern. Unknown ids print as 'state'."""
        st = self.states.get(sid)
        return self.sanitizer().state_id(st["base"], sid) if st else "state"

    def explore(self, sid: str) -> None:
        t0 = time.perf_counter()
        self.t_press = self.t_reach = self.t_enum = 0.0
        self.n_press = 0
        try:
            self._explore(sid)
        finally:
            total = (time.perf_counter() - t0) * 1000
            self.log(f"  state {self.ref(sid)}: {total:.0f} ms total, {self.t_reach:.0f} reach, {self.t_enum:.0f} enum, "
                     f"{self.n_press} presses {self.t_press:.0f} ms")

    def _explore(self, sid: str) -> None:
        st = self.states[sid]
        t = time.perf_counter()
        ok = self.reach(sid)
        self.t_reach = (time.perf_counter() - t) * 1000
        self.t_enum = 0.0
        if not ok:
            st["reach_fail"] += 1
            self.log(f"  unreachable {self.ref(sid)}")
            return
        t = time.perf_counter()
        els = self.p.js("JSON.stringify(window.__cm.enum())") or []
        self.t_enum = (time.perf_counter() - t) * 1000
        info = self.p.js("JSON.stringify({o: window.__cm.overlays().length, k: [...window.__cm.keys(window.__cm.scope())]})")
        st["baseline"], st["overlays"] = sorted(info["k"]), info["o"]
        st["dirty_on_entry"] = self.dirty
        # A panel, tab or inline state keeps the page under it. Only what its
        # opener unlocked is new; everything else is the parent's and was (or
        # will be) explored there. Without this, the workflow canvas re-pressed
        # the header in every panel on 2026-10-09 and states multiplied.
        parent_keys = set()
        if st["chain"] and st["overlays"] == 0:
            parent = self.states.get(self.state_id(st["base"], st["chain"][:-1]))
            if parent:
                # What the parent page showed at any read, and everything it
                # recorded: a sidebar collapsed on one read is still the parent's.
                parent_keys = {shape(k.rpartition("|")[0]) + "|" + k.rpartition("|")[2] for k in parent["baseline"]}
                parent_keys |= set(parent["elements"])
        # A long list of controls with one structure (field pickers, filter
        # rows) behaves alike: press the first LIST_SAMPLE, record the rest as
        # siblings. Without this, People segment panels took ~10 min a state.
        by_struct: dict[str, int] = {}
        for el in els:
            by_struct[el["struct"]] = by_struct.get(el["struct"], 0) + 1
        sampled: dict[str, list] = {}
        explorable = 0
        for el in els:
            k = ekey(el)
            if k in st["elements"]:
                continue
            if parent_keys and (shape(el["struct"]) + "|" + (el["testid"] or el["label"]) in parent_keys or k in parent_keys):
                continue
            rec = {"key": k, "role": el["role"], "label": el["label"], "testid": el["testid"], "popup": el["popup"],
                   "template": el["template"], "instances": el["instances"], "struct": el["struct"]}
            st["elements"][k] = rec
            self.new_found += 1
            if el["template"] and el["index"] > 0:
                rec["disposition"] = "template-instance"
                continue
            if el["href"]:
                dest = pattern(el["href"])
                if SKIP_LINK.search(el["href"]):
                    rec.update(disposition="gate", reason="link creates or signs out", to=dest)
                else:
                    to = self.add_state(dest, [], "page", el["href"])
                    rec.update(disposition="link", to=to, kind="page")
                continue
            if el["ext"]:
                rec.update(disposition="external", to=el["ext"], kind="external")
                continue
            if el["gate"] or el["deny"]:
                rec.update(disposition="gate", reason="gate word" if el["gate"] else "writes a preference or sends")
                continue
            if el["field"] or el["toggle"]:
                rec.update(disposition="field" if el["field"] else "toggle", reason="typing or toggling writes")
                continue
            if not st["chain"]:
                seen_on = self.page_keys.setdefault(k, [])
                if sid not in seen_on:
                    seen_on.append(sid)
                if (el["chrome"] and st["base"] != "/workspaces/{ws}/home") or len(seen_on) > 2:
                    rec.update(disposition="chrome", to=seen_on[0])
                    continue
            if el["selected"] and el["role"] == "tab":
                rec.update(disposition="current-tab")
                continue
            if by_struct[el["struct"]] >= LIST_MIN and not el["template"]:
                done = sampled.setdefault(el["struct"], [])
                if len(done) >= LIST_SAMPLE:
                    first = done[0]
                    rec.update(disposition="sibling", kind=first.get("kind"), reason=f"same structure as {len(done)} pressed siblings")
                    continue
                done.append(rec)
            explorable += 1
            if explorable > PER_STATE_CAP:
                rec.update(disposition="unexplored", reason="per-state cap")
                continue
            self.press(sid, el, rec)
        st["explored"] = True

    def press(self, sid: str, el: dict, rec: dict) -> None:
        st = self.states[sid]
        desc = {"struct": el["struct"], "tail": el["testid"] or el["label"], "template": el["template"], "index": el["index"],
                "key": rec["key"], "label": el["label"], "role": el["role"]}
        t_start = time.perf_counter()
        self.n_press += 1
        try:
            self._press(sid, st, el, rec, desc)
        finally:
            self.t_press += (time.perf_counter() - t_start) * 1000

    def _press(self, sid, st, el, rec, desc) -> None:
        if not self.reach(sid):
            rec.update(disposition="unexplored", reason="could not return to the state")
            return
        try:
            r = self.press_desc(desc)
        except OffOrigin:
            self.dirty = True
            rec.update(disposition="explored", kind="leaves-clay", reason="leaves Clay")
            self.p.back_to_clay(self.ws)
            return
        except Exception as exc:
            self.dirty = True
            if "hung" in str(exc) or "timed out" in str(exc) or "-32000" in str(exc):
                # The tab froze or reloaded mid-press. That says nothing about
                # the element, so forget it and let the next pass press it again
                # (on 2026-10-09 these were mislabelled as document loads).
                st["elements"].pop(rec["key"], None)
                self.retry += 1
                return
            time.sleep(3)
            self.p.install()
            r = None
            rec.update(disposition="explored", kind="document-load")
        if r is None:
            rec.setdefault("disposition", "unexplored")
            rec.setdefault("reason", "element not found on replay")
            return
        kind, to = self.classify(sid, r, desc)
        rec.update(disposition="explored", kind=kind, to=to, ms=r["timing"]["first_ms"], quiet_ms=r["timing"]["quiet_ms"],
                   unlocked=r["fresh_count"], unlocked_sample=[f["role"] + ":" + f["label"] for f in r["fresh"][:12]],
                   requests=clean_requests(r.get("requests")))
        if to is None and kind in ("panel", "menu", "modal", "popover"):
            rec["reason"] = "depth cap: what it unlocked is listed, not expanded"
        if r["blocked"]:
            rec.update(disposition="gate", reason="tried to write: " + ", ".join(sorted(set(r["blocked"])))[:200], kind="write-blocked")
        self.edges[(sid, rec["key"])] = rec
        self.log_press(sid, el, kind, to, r)

    def classify(self, sid: str, r: dict, desc: dict) -> tuple[str, str | None]:
        st = self.states[sid]
        if r["blocked"]:
            return "write-blocked", None
        p0, p1 = pattern(r["url0"]), pattern(r["url1"])
        ws1 = re.search(r"/workspaces/(\d+)", r["url1"])
        if ws1 and ws1.group(1) != self.ws:
            # Another client's workspace: record the switch, never crawl it.
            self.dirty = True
            self.p.hop(f"/workspaces/{self.ws}/home")
            return "workspace-switch", None
        if not r["url1"].startswith("/workspaces/"):
            self.dirty = True
            return "page-outside-workspace", p1
        if p1 != p0:
            to = self.add_state(p1, [], "page", r["url1"])
            self.dirty = True
            return ("tab-url" if p1.split("?")[0] == p0.split("?")[0] else "page"), to
        if r["overlays"] > 0 or r["fresh_count"] > 0:
            kind = {"menu": "menu", "listbox": "menu", "dialog": "modal", "alertdialog": "modal", "tooltip": "tooltip"}.get(r["overlay"], "popover") \
                if r["overlays"] > 0 else ("panel" if r["fresh_count"] >= 3 else "inline")
            if kind == "tooltip":
                return kind, None
            if r["overlays"] == 0:
                self.dirty = True
            # One or two revealed controls (an expanded row, a field picker
            # line) are an edge, not a screen. Panels nest at most two deep:
            # on 2026-10-09 the People filter builder opened panels inside
            # panels, and each level cost a full remount and replay per press.
            if kind == "inline" or (r["overlays"] == 0 and len(st["chain"]) >= MAX_PANEL_DEPTH) \
                    or len(st["chain"]) >= MAX_CHAIN:
                return kind, None
            to = self.add_state(st["base"], st["chain"] + [desc], kind, marker=[f["key"] for f in r["fresh"][:12]])
            if r["overlays"] == 0:
                self.dirty = True
            return kind, to
        if r["gone"]:
            self.dirty = True
            return "in-place", None
        return "nothing", None

    def resume_private(self, saved: dict) -> int:
        self.states = saved["states"]
        for st in self.states.values():
            rekeyed = {}
            for k, e in st["elements"].items():
                struct, _, tail = k.rpartition("|")
                nk = shape(struct) + "|" + tail
                if nk not in rekeyed:
                    rekeyed[nk] = dict(e, key=nk)
            st["elements"] = rekeyed
        # Drop what a failed replay recorded from the parent page into a
        # panel state (see opened()).
        for sid, st in self.states.items():
            if st["chain"] and st.get("overlays", 0) == 0:
                parent = self.states.get(self.state_id(st["base"], st["chain"][:-1]))
                if parent:
                    for k in [k for k in st["elements"] if k in parent["elements"]]:
                        del st["elements"][k]
        self.urls.update(saved.get("urls", {}))
        self.hop_ms.update(saved.get("hop_ms", {}))
        self.page_keys.update(saved.get("page_keys", {}))
        for sid, st in self.states.items():
            if not st["explored"] and st.get("reach_fail", 0) < 2:
                self.queue.append(sid)
        return len(self.states)

    def resume(self, m: dict, urls: dict) -> int:
        """Load a checkpointed elements.json: reached states keep their
        elements and count as explored for pass 1; the rest are queued."""
        self.urls.update(urls)
        for sid, cs in m["states"].items():
            chain = []
            for c in cs["chain"]:
                struct, _, tail = c["key"].rpartition("|")
                chain.append({"struct": struct, "tail": tail, "template": tail == "<per-row>", "index": 0, "key": c["key"],
                              "label": c["label"], "role": c["role"]})
            st = {"id": sid, "base": cs["base"], "chain": chain, "kind": cs["kind"], "elements": {}, "baseline": [],
                  "overlays": 0, "marker": [], "explored": bool(cs.get("reached")), "reach_fail": 0,
                  "load_requests": cs.get("load_requests") or []}
            if cs.get("redirects_to"):
                st["match"] = cs["redirects_to"]
            for e in cs["elements"]:
                tail = e.get("testid") or ("<per-row>" if e.get("template") and e["label"] == "<per-row>" else e["label"])
                k = e["struct"] + "|" + tail
                st["elements"][k] = dict(e, key=k)
                if not chain:
                    self.page_keys.setdefault(k, []).append(sid)
            self.states[sid] = st
            if not st["explored"]:
                self.queue.append(sid)
        return len(self.states)

    def run(self, passes_quiet: int = 2, max_passes: int = 6, max_states: int = 0) -> dict:
        home = self.add_state("/workspaces/{ws}/home", [], "page", f"/workspaces/{self.ws}/home")
        quiet, n = 0, 0
        while quiet < passes_quiet and n < max_passes:
            n += 1
            self.new_found = 0
            if n > 1:
                for sid in sorted(self.states, key=lambda k: (self.states[k]["base"], len(self.states[k]["chain"]), k)):
                    st = self.states[sid]
                    if st["reach_fail"] < 2:
                        st["explored"] = False
                        self.queue.append(sid)
            seen = set()
            while self.queue:
                sid = self.queue.popleft()
                if sid in seen or self.states[sid]["explored"]:
                    continue
                seen.add(sid)
                if max_states and len(seen) > max_states:
                    self.queue.clear()
                    break
                self.log(f"[pass {n}] {self.ref(sid)} ({len(self.states)} states)")
                try:
                    self.explore(sid)
                except Exception as exc:  # one bad state must not end a multi-hour crawl
                    self.states[sid]["reach_fail"] += 1
                    self.log_error(sid, exc)
                    self.dirty = True
                    try:
                        self.p.install()
                    except Exception:
                        time.sleep(5)
                if self.checkpoint:
                    self.checkpoint(self, {"passes": n}, False)
            # A pass only counts as quiet when it found nothing new AND re-read
            # every state it could. On 2026-10-09 a pass where the tab had hung
            # reported "0 new" because it had read nothing at all.
            pending = [k for k, v in self.states.items() if not v["explored"] and v["reach_fail"] < 2]
            if self.retry:
                self.log(f"  {self.retry} presses lost to a hung tab, retried next pass")
                self.new_found += self.retry
                self.retry = 0
            self.log(f"pass {n}: {self.new_found} new states or elements, {len(pending)} states not re-read, "
                     f"{getattr(self.p, 'hangs', 0)} tab recoveries so far")
            quiet = quiet + 1 if (n > 1 and self.new_found == 0 and not pending) else 0
        return {"passes": n, "home": home}
