"""github: the pull requests and CI that need Caleb, without opening GitHub.

Replaces opening github.com in Chrome to answer three questions: who is
waiting on my review, which of my PRs are failing or have changes asked, and
is main green in the repos I actually work in. Plus the issues assigned to
him. Picking a PR shows its checks and the first lines of its body.

ONE READ, ONE CALL. Everything comes from a single `gh api graphql` query:
three searches (review-requested, authored, assigned) and one `repository`
lookup per local repo, each reading the status rollup of the default
branch's head commit, which is the combined result of every check run on
the latest push to main. So the drill-down costs no extra call, and a
refresh costs one GraphQL point. Repo names go in as GraphQL variables,
never into the query text, so a crafted remote URL cannot change the query.

NOTHING HERE WRITES. The only CLI argv this module will run is `gh api
graphql` with the fixed query built below and `-f` variables; anything else
(merge, close, comment, rerun, a REST call, a query that says `mutation`) is
refused before it reaches a shell, by `allowed()`. The one action on the
glass, Checks, only moves the Select to a row already fetched: it runs
nothing. "Open in browser" is deliberately absent, because the point of the
panel is that no app opens.

UNTRUSTED TEXT. Titles, bodies, logins, branch names, check names and commit
headlines are written by other people. Every one goes through `clean()`,
which drops Unicode control and format characters (escape sequences, bidi
overrides, zero-width joiners) and folds whitespace, and is only ever
rendered inside a JSON string on a `d` line. No handler reads it.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, ago, clip, comp, note_for, parse_time

# Guessed, never measured: the task brief's floor. At one GraphQL point a
# call that is 60 an hour against a 5,000 point budget (gh api rate_limit on
# 2026-10-05 read limit 5000, used 0).
CACHE_TTL_S = 60.0
# Guessed, never measured. A rate-limit answer means stop asking for a while;
# five minutes is long enough that the panel cannot be what keeps it limited.
RATE_LIMITED_TTL_S = 300.0
# ~/code held 71 git checkouts with a GitHub remote on 2026-10-05, 23 of them
# under refs/ (other people's code kept to read). Twelve covers every group he
# touched that week, and keeps one call well under GraphQL's node limit.
MOST_REPOS = 12
# refs/ is other people's code kept to read and archive/ is retired work:
# their CI is never his to fix.
SKIP_GROUPS = {"refs", "archive", "node_modules"}
# Rows shown per table: Miller's limit in the house checklist is nine.
MOST_NEEDS = 8
MOST_CI = 8
MOST_ISSUES = 5
BODY_LINES = 3
# His authored open PRs numbered 18 on 2026-10-05. A page of 30 dropped a
# failing PR at position 31 with no word said (review, 2026-10-05), so the
# page is GitHub's own ceiling for `first` on search, and `issueCount` says
# how many sit past it.
SEARCH_PAGE = 100
CHECKS_PER_COMMIT = 25

# Matched with fullmatch only: `$` also matches before a trailing newline, and
# `n1=b\n` got through the allowlist that way (review, 2026-10-05).
OWNER_REPO = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}")
REMOTE = re.compile(r"(?:https://(?:[^@/]+@)?github\.com/|ssh://git@github\.com/|git@github\.com:)"
                    r"(?P<repo>[^/\s]+/[^/\s]+?)(?:\.git)?/?")
VARIABLE = re.compile(r"(?:q_review|q_mine|q_issues|o\d{1,2}|n\d{1,2})")
# The searches whose loss makes the panel's all-clear a lie.
SEARCH_NAMES = ("review", "mine", "issues")


def valid_repo(text: str) -> bool:
    """A plain owner/name GitHub could have sent. "." and ".." are not names."""
    if not isinstance(text, str) or not OWNER_REPO.fullmatch(text):
        return False
    return text.split("/", 1)[1] not in (".", "..")

CHECKS = """statusCheckRollup { state contexts(first: %d) { nodes { __typename
  ... on CheckRun { name status conclusion } ... on StatusContext { context state } } } }""" % CHECKS_PER_COMMIT

PR_FIELDS = """... on PullRequest { number title url updatedAt isDraft reviewDecision bodyText
  repository { nameWithOwner } author { login }
  commits(last: 1) { nodes { commit { %s } } } }""" % CHECKS

ISSUE_FIELDS = "... on Issue { number title updatedAt repository { nameWithOwner } author { login } }"

SEARCHES = {
    "q_review": "is:pr is:open archived:false review-requested:@me sort:updated-desc",
    "q_mine": "is:pr is:open archived:false author:@me sort:updated-desc",
    "q_issues": "is:issue is:open archived:false assignee:@me sort:updated-desc",
}


def build_query(n_repos: int) -> str:
    """The fixed query for `n_repos` repos. Only indices are formatted in;
    owner and name arrive as variables $oN and $nN."""
    params = ["$q_review: String!", "$q_mine: String!", "$q_issues: String!"]
    repos = []
    for i in range(n_repos):
        params += [f"$o{i}: String!", f"$n{i}: String!"]
        repos.append(f"r{i}: repository(owner: $o{i}, name: $n{i}) {{ nameWithOwner "
                     f"defaultBranchRef {{ name target {{ ... on Commit {{ messageHeadline committedDate {CHECKS} }} }} }} }}")
    return (f"query({', '.join(params)}) {{ viewer {{ login }} "
            f"review: search(query: $q_review, type: ISSUE, first: {SEARCH_PAGE}) {{ issueCount nodes {{ {PR_FIELDS} }} }} "
            f"mine: search(query: $q_mine, type: ISSUE, first: {SEARCH_PAGE}) {{ issueCount nodes {{ {PR_FIELDS} }} }} "
            f"issues: search(query: $q_issues, type: ISSUE, first: {MOST_ISSUES}) {{ issueCount nodes {{ {ISSUE_FIELDS} }} }} "
            + " ".join(repos) + " }")


def argv_for(repos: list[str]) -> list[str]:
    argv = ["gh", "api", "graphql", "-f", "query=" + build_query(len(repos))]
    for key, value in SEARCHES.items():
        argv += ["-f", f"{key}={value}"]
    for i, repo in enumerate(repos):
        owner, name = repo.split("/", 1)
        argv += ["-f", f"o{i}={owner}", "-f", f"n{i}={name}"]
    return argv


def allowed(argv: list[str]) -> bool:
    """True only for exactly the read this module builds. Fails closed: any
    other subcommand, flag, method, variable or query text is refused."""
    if len(argv) < 5 or argv[:3] != ["gh", "api", "graphql"] or len(argv[3:]) % 2:
        return False
    pairs = list(zip(argv[3::2], argv[4::2]))
    if any(flag != "-f" or "=" not in val for flag, val in pairs):
        return False
    keys = [val.split("=", 1)[0] for _, val in pairs]
    if keys[0] != "query" or len(set(keys)) != len(keys):
        return False
    fields = dict(val.split("=", 1) for _, val in pairs)
    repos = sum(1 for k in keys if k.startswith("o"))
    want = {"query", *SEARCHES} | {f"o{i}" for i in range(repos)} | {f"n{i}" for i in range(repos)}
    if set(keys) != want or any(fields[k] != v for k, v in SEARCHES.items()):
        return False
    if any(not VARIABLE.fullmatch(k) for k in keys[1:]):
        return False
    if not all(valid_repo(f"{fields[f'o{i}']}/{fields[f'n{i}']}") for i in range(repos)):
        return False
    query = fields["query"]
    return query == build_query(repos) and not re.search(r"\bmutation\b", query, re.I)


def repos_in(argv: list[str]) -> list[str]:
    """The owner/name pairs an allowed argv asks about, in its order."""
    fields = dict(v.split("=", 1) for v in argv[4::2])
    return [f"{fields[f'o{i}']}/{fields[f'n{i}']}" for i in range(sum(1 for k in fields if k.startswith("o")))]


class Cache:
    """One gh answer for the whole process, with the argv that asked it.

    One slot, not one per argv: keyed by argv, working in another repo
    reorders the repo list, the argv changes, and both holds were skipped.
    That made 2 gh calls in 122 s while rate limited (review, 2026-10-05).
    Now any fetch inside the hold gets the last answer and the repos that
    answer covers, whatever repos it would have asked about. A failed call is
    held too, so a broken network is asked about once a minute and a rate
    limit once every five, not on every refresh or press."""

    def __init__(self) -> None:
        self.last: tuple[float, float, list[str], tuple] | None = None

    def run(self, ctx: Context, argv: list[str]) -> tuple[list[str], tuple]:
        if not allowed(argv):
            raise SurfaceError("Refused a GitHub call this panel does not make. Nothing was sent.")
        now = ctx.now().timestamp()
        if self.last and now - self.last[0] < self.last[1]:
            return self.last[2], self.last[3]
        answer = ctx.run(argv)
        code, out, err = answer
        ttl = RATE_LIMITED_TTL_S if code != 0 and "rate limit" in f"{out} {err}".lower() else CACHE_TTL_S
        self.last = (now, ttl, list(argv), answer)
        return list(argv), answer

    def clear(self) -> None:
        self.last = None


CACHE = Cache()


def clean(text, limit: int) -> str:
    """Someone else's words, safe to draw: no control or format characters
    (category C: escapes, bidi overrides, zero-width), whitespace folded."""
    text = "".join(" " if unicodedata.category(ch)[0] == "C" else ch for ch in str(text or ""))
    return clip(text, limit)


def remote_of(git_dir: Path) -> str | None:
    """owner/repo of the origin remote, read from .git/config without
    running git. Only github.com, only a plain owner/name."""
    try:
        text = (git_dir / "config").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    section = ""
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("["):
            section = line
            continue
        if section == '[remote "origin"]' and line.startswith("url") and "=" in line:
            m = REMOTE.fullmatch(line.split("=", 1)[1].strip())
            if m and valid_repo(m.group("repo")):
                return m.group("repo")
    return None


def last_touched(git_dir: Path) -> float:
    best = 0.0
    for name in ("HEAD", "index", "FETCH_HEAD", "logs/HEAD", "ORIG_HEAD"):
        try:
            best = max(best, (git_dir / name).stat().st_mtime)
        except OSError:
            continue
    return best


def local_repos(root: Path, most: int = MOST_REPOS) -> list[str]:
    """GitHub repos checked out at ~/code/<repo> or ~/code/<group>/<repo>,
    most recently touched first. A `.git` that is a file (a worktree or a
    submodule) is skipped: its main checkout is counted already."""
    touched: dict[str, float] = {}
    spelled: dict[str, str] = {}
    candidates = []
    try:
        top = [p for p in root.iterdir() if p.is_dir() and not p.is_symlink()]
    except OSError:
        return []
    for d in top:
        if d.name.startswith(".") or d.name in SKIP_GROUPS:
            continue
        candidates.append(d)
        try:
            candidates += [p for p in d.iterdir() if p.is_dir() and not p.is_symlink() and not p.name.startswith(".")]
        except OSError:
            continue
    for repo_dir in candidates:
        git = repo_dir / ".git"
        if not git.is_dir() or git.is_symlink():
            continue
        name = remote_of(git)
        if not name:
            continue
        # Two checkouts of one repo are one row: GitHub names are case-blind.
        key = name.lower()
        spelled.setdefault(key, name)
        touched[key] = max(touched.get(key, 0.0), last_touched(git))
    ranked = sorted(touched, key=lambda k: touched[k], reverse=True)
    return [spelled[k] for k in ranked[:most]]


def check_state(node: dict) -> tuple[str, str]:
    """(name, one word) for a CheckRun or a StatusContext."""
    if node.get("__typename") == "StatusContext":
        state = (node.get("state") or "").upper()
        word = {"SUCCESS": "passed", "FAILURE": "failed", "ERROR": "failed",
                "PENDING": "running", "EXPECTED": "waiting"}.get(state, state.lower() or "unknown")
        return clean(node.get("context"), 48), word
    if (node.get("status") or "").upper() != "COMPLETED":
        return clean(node.get("name"), 48), "running"
    conclusion = (node.get("conclusion") or "").upper()
    word = {"SUCCESS": "passed", "FAILURE": "failed", "TIMED_OUT": "failed", "STARTUP_FAILURE": "failed",
            "CANCELLED": "cancelled", "SKIPPED": "skipped", "NEUTRAL": "neutral",
            "ACTION_REQUIRED": "needs action", "STALE": "stale"}.get(conclusion, conclusion.lower() or "unknown")
    return clean(node.get("name"), 48), word


ROLLUP = {"SUCCESS": "passing", "FAILURE": "failing", "ERROR": "failing", "PENDING": "running",
          "EXPECTED": "waiting"}
FAILED = {"failed", "needs action"}


def rollup_of(commit: dict | None) -> tuple[str, list[dict]]:
    roll = (commit or {}).get("statusCheckRollup")
    if not roll:
        return "no CI", []
    checks = []
    for node in ((roll.get("contexts") or {}).get("nodes") or []):
        if isinstance(node, dict):
            name, word = check_state(node)
            checks.append({"name": name, "state": word})
    # Failures first: the one he needs is the one that broke.
    checks.sort(key=lambda c: (c["state"] not in FAILED, c["state"] != "running", c["name"]))
    return ROLLUP.get((roll.get("state") or "").upper(), "unknown"), checks


def body_lines(text) -> list[str]:
    lines = []
    for raw in str(text or "").splitlines():
        line = clean(raw, 100)
        if line and not line.startswith("<!--"):
            lines.append(line)
        if len(lines) == BODY_LINES:
            break
    return lines


def stamp(text: str) -> float:
    moment = parse_time(text)
    return moment.timestamp() if moment else 0.0


def short_repo(name: str, login: str) -> str:
    owner, _, repo = name.partition("/")
    return repo if owner.lower() == login.lower() else name


def pr_row(node: dict, why: str, login: str) -> dict | None:
    repo = (node.get("repository") or {}).get("nameWithOwner") or ""
    number = node.get("number")
    if not valid_repo(repo) or not isinstance(number, int):
        return None
    commits = ((node.get("commits") or {}).get("nodes") or [{}])
    state, checks = rollup_of((commits[-1] or {}).get("commit") if commits else None)
    return {"id": f"gh:pr:{repo}#{number}", "repo": repo, "number": number,
            "ref": f"{clean(short_repo(repo, login), 40)}#{number}",
            "title": clean(node.get("title"), 90), "why": why, "updated": node.get("updatedAt") or "",
            "author": clean((node.get("author") or {}).get("login") or "ghost", 39),
            "draft": bool(node.get("isDraft")), "decision": (node.get("reviewDecision") or "").upper(),
            "state": state, "checks": checks, "body": body_lines(node.get("bodyText"))}


def parse(payload, repos: list[str]) -> dict:
    """The fetch's data from one GraphQL answer. Missing pieces (a repo that
    was renamed or is private to someone else) are counted, not fatal."""
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        raise SurfaceError("GitHub answered without data. Try again in a minute.")
    data = payload["data"]
    login = clean(((data.get("viewer") or {}).get("login")) or "", 39)
    needs, seen = [], set()

    def add(row):
        if row and row["id"] not in seen:
            seen.add(row["id"])
            needs.append(row)

    for node in ((data.get("review") or {}).get("nodes") or []):
        if isinstance(node, dict):
            add(pr_row(node, "review asked", login))
    mine_seen = 0
    for node in ((data.get("mine") or {}).get("nodes") or []):
        if not isinstance(node, dict):
            continue
        row = pr_row(node, "", login)
        if row is None:
            continue
        mine_seen += 1
        if row["state"] == "failing":
            row["why"] = "checks failing"
        elif row["decision"] == "CHANGES_REQUESTED":
            row["why"] = "changes asked"
        else:
            continue
        add(row)
    order = {"review asked": 0, "checks failing": 1, "changes asked": 2}
    needs.sort(key=lambda r: (order.get(r["why"], 3), -stamp(r["updated"])))
    for i, r in enumerate(needs):
        r["label"] = clip(f"{r['ref']} {r['title']}", 56)
        if any(x["label"] == r["label"] for x in needs[:i]):
            r["label"] += f" ({i + 1})"

    issues = []
    for node in ((data.get("issues") or {}).get("nodes") or []):
        repo = ((node or {}).get("repository") or {}).get("nameWithOwner") or ""
        if isinstance(node, dict) and valid_repo(repo) and isinstance(node.get("number"), int):
            issues.append({"ref": f"{clean(short_repo(repo, login), 40)}#{node['number']}",
                           "title": clean(node.get("title"), 90), "updated": node.get("updatedAt") or ""})

    ci, no_ci, missing = [], 0, 0
    for i, _ in enumerate(repos):
        node = data.get(f"r{i}")
        if not isinstance(node, dict):
            missing += 1
            continue
        branch = node.get("defaultBranchRef") or {}
        commit = branch.get("target") or {}
        state, checks = rollup_of(commit)
        if state == "no CI":
            no_ci += 1
            continue
        ci.append({"repo": clean(short_repo(node.get("nameWithOwner") or "", login), 48),
                   "branch": clean(branch.get("name"), 30), "state": state,
                   "headline": clean(commit.get("messageHeadline"), 70), "when": commit.get("committedDate") or "",
                   "failing": [c["name"] for c in checks if c["state"] in FAILED][:3]})
    rank = {"failing": 0, "running": 1, "waiting": 2, "unknown": 3, "passing": 4}
    ci.sort(key=lambda r: (rank.get(r["state"], 3), r["repo"].lower()))
    errors = [e for e in (payload.get("errors") or []) if isinstance(e, dict)]
    # A search GitHub nulled, or one an error points inside, came back short:
    # with review and mine both null on 2026-10-05's outage probe, the panel
    # said "Nothing on GitHub needs you." Those searches are named, never
    # read as empty.
    hit = {str((e.get("path") or [""])[0]) for e in errors if isinstance(e.get("path"), list)}
    lost = [name for name in SEARCH_NAMES if not isinstance(data.get(name), dict) or name in hit]
    return {"login": login, "needs": needs, "issues": issues, "ci": ci, "scanned": len(repos),
            "mine_open": max(total(data, "mine"), mine_seen), "mine_seen": mine_seen,
            "review_total": total(data, "review"), "review_seen": sum(1 for r in needs if r["why"] == "review asked"),
            "issues_total": max(total(data, "issues"), len(issues)), "lost": lost,
            "no_ci": no_ci, "missing": missing, "errors": len(payload.get("errors") or [])}


def total(data: dict, name: str) -> int:
    """A search's issueCount: how many match, not how many came back."""
    count = (data.get(name) or {}).get("issueCount") if isinstance(data.get(name), dict) else None
    return count if isinstance(count, int) and count >= 0 else 0


def gh_error(code: int, text: str) -> str:
    low = (text or "").lower()
    if code == 127:
        return "The gh CLI isn't installed. `brew install gh`, then `gh auth login`."
    if "auth login" in low or "not logged" in low or "401" in low:
        return "gh isn't signed in. Run `gh auth login` once."
    if "rate limit" in low:
        return "GitHub's rate limit is spent. This panel waits five minutes before asking again."
    if code == 124:
        return "GitHub took too long to answer."
    first = clean((text or "").strip().splitlines()[0] if (text or "").strip() else "no output", 100)
    return f"GitHub didn't answer: {first}"


class GitHub(Provider):
    name = "github"
    title = "GITHUB"
    region = "left"
    width = 440
    refresh = CACHE_TTL_S
    replaces = "GitHub in Chrome"

    def __init__(self) -> None:
        super().__init__()
        # Read-only by construction: the one handler moves the Select.
        self.actions = {f"{ACTION_PREFIX}detail": self.detail}

    def code_root(self, ctx: Context) -> Path:
        return Path(ctx.env.get("KYBER_SURFACES_CODE") or ctx.home / "code")

    def fetch(self, ctx: Context) -> dict:
        # The answer may be the held one, built for an older repo list: parse
        # it against the repos it was asked about, not today's.
        asked, (code, out, err) = CACHE.run(ctx, argv_for(local_repos(self.code_root(ctx))))
        repos = repos_in(asked)
        payload = None
        try:
            payload = json.loads(out) if (out or "").strip() else None
        except json.JSONDecodeError:
            payload = None
        # gh exits 1 when GraphQL reports any error, even with the rest of the
        # data there (a repo renamed away): keep what came back.
        if code != 0 and not (isinstance(payload, dict) and isinstance(payload.get("data"), dict)):
            raise SurfaceError(gh_error(code, err or out))
        if payload is None:
            raise SurfaceError("GitHub answered with something that is not JSON.")
        return parse(payload, repos)

    def layout(self) -> list[str]:
        c, p = self.cid, self.p
        return [
            comp(c("s"), "Screen", title=self.title),
            comp(c("note"), "Text", value=Bind(p("note")), tone="muted"),
            comp(c("list"), "Table", columns=Bind(p("needs_cols")), rows=Bind(p("needs")),
                 action=f"{ACTION_PREFIX}detail", actionLabel="Checks"),
            comp(c("pick"), "Select", label="PR", options=Bind(p("names")), value=Bind(p("pick"))),
            comp(c("head"), "Text", value=Bind(p("head"))),
            comp(c("checks"), "List", items=Bind(p("checks"))),
            comp(c("body"), "List", items=Bind(p("body"))),
            comp(c("cih"), "Heading", text="Main", level=2),
            comp(c("ci"), "Table", columns=Bind(p("ci_cols")), rows=Bind(p("ci"))),
            comp(c("cinote"), "Text", value=Bind(p("ci_note")), tone="muted"),
            comp(c("ish"), "Heading", text="Assigned to you", level=2),
            comp(c("issues"), "Table", columns=Bind(p("issue_cols")), rows=Bind(p("issues"))),
            comp(c("isnote"), "Text", value=Bind(p("issue_note")), tone="muted"),
            comp(c("status"), "Text", value=Bind(p("status")), tone="muted"),
            f"> {c('s')} {c('note')} {c('list')} {c('pick')} {c('head')} {c('checks')} {c('body')} "
            f"{c('cih')} {c('ci')} {c('cinote')} {c('ish')} {c('issues')} {c('isnote')} {c('status')}",
            f"r {c('s')}",
        ]

    def initial(self) -> dict:
        return {
            self.p("pick"): "", self.p("status"): "",
            self.p("needs_cols"): [{"field": "ref", "label": "PR"}, {"field": "title", "label": "Title"},
                                   {"field": "why", "label": "Why"}, {"field": "age", "label": "Updated"}],
            self.p("ci_cols"): [{"field": "repo", "label": "Repo"}, {"field": "state", "label": "CI"},
                                {"field": "what", "label": "Last push"}, {"field": "age", "label": "When"}],
            self.p("issue_cols"): [{"field": "ref", "label": "Issue"}, {"field": "title", "label": "Title"},
                                   {"field": "age", "label": "Updated"}],
        }

    def chosen(self, data, values: dict) -> dict | None:
        """Exactly the picked PR, never a default."""
        rows = (data or {}).get("needs") or []
        label = values.get(self.p("pick"))
        matches = [r for r in rows if r["label"] == label]
        return matches[0] if len(matches) == 1 else None

    def model(self, data, error, values, ctx) -> dict:
        p = self.p
        if data is None:
            return {p("note"): note_for(None, error, ""), p("needs"): [], p("names"): [], p("head"): "",
                    p("checks"): [], p("body"): [], p("ci"): [], p("ci_note"): "", p("issues"): [],
                    p("issue_note"): ""}
        now = ctx.now()
        needs = data["needs"][:MOST_NEEDS]
        waiting = max(data.get("review_total", 0), sum(1 for r in data["needs"] if r["why"] == "review asked"))
        mine, seen = data.get("mine_open", 0), data.get("mine_seen", 0)
        lost = [x for x in data.get("lost", []) if x in ("review", "mine")]
        if lost:
            # Never an all-clear built on a search that didn't come back.
            what = " and ".join({"review": "review requests", "mine": "your PRs"}[x] for x in lost)
            empty = f"GitHub didn't send {what}, so this list may be missing some. Trying again in a minute."
        elif not needs:
            empty = "Nothing on GitHub needs you." + (
                f" {mine} of your PRs {'is' if mine == 1 else 'are'} open, none failing." if mine == seen and mine else
                f" The {seen} most recently updated of your {mine} open PRs aren't failing;"
                f" the other {mine - seen} weren't checked." if mine else "")
        else:
            failing = len(data["needs"])
            empty = (f"{waiting} review{'s' if waiting != 1 else ''} asked of you." if waiting else
                     f"{failing} of your PRs {'needs' if failing == 1 else 'need'} a look.")
            if failing > MOST_NEEDS:
                empty += f" {failing - MOST_NEEDS} more not shown."
        # The unchecked count used to be said only in the all-clear branch, so
        # with 140 open and 2 failing the note read as if all 140 were checked
        # (review, 2026-10-05). Any note not already blaming a lost search
        # owns up to the PRs past the search page.
        if needs and "mine" not in lost and mine > seen:
            empty += f" {mine - seen} of your {mine} open PRs weren't checked."
        out = {
            p("note"): note_for(data, error, empty, data.get("_at")),
            p("needs"): [{"id": r["id"], "ref": r["ref"], "title": clip(r["title"], 44) + (" (draft)" if r["draft"] else ""),
                          "why": r["why"], "age": ago(parse_time(r["updated"]), now)} for r in needs],
            p("names"): [r["label"] for r in needs],
        }
        shown = self.chosen({"needs": needs}, values) or (needs[0] if needs else None)
        # The Select always names the PR described under it. A pick that left
        # the list used to stay in the Select while the head and body showed
        # rows[0] (review, 2026-10-05), so the pick is rewritten whenever it
        # is not the row shown, including to "" when the list empties.
        want = shown["label"] if shown else ""
        if values.get(p("pick")) != want:
            out[p("pick")] = want
        if shown:
            decision = {"APPROVED": "approved", "CHANGES_REQUESTED": "changes requested",
                        "REVIEW_REQUIRED": "review required"}.get(shown["decision"], "")
            out[p("head")] = " · ".join(x for x in (f"{shown['ref']} by {shown['author']}", f"CI {shown['state']}",
                                                     decision) if x)
            out[p("checks")] = [f"{c['state']}: {c['name']}" for c in shown["checks"][:6]] or ["No checks on this PR."]
            out[p("body")] = shown["body"] or ["No description."]
        else:
            out.update({p("head"): "", p("checks"): [], p("body"): []})
        ci = data["ci"][:MOST_CI]
        out[p("ci")] = [{"repo": r["repo"], "state": r["state"] + (f" ({', '.join(r['failing'])})" if r["failing"] else ""),
                         "what": clip(r["headline"], 40), "age": ago(parse_time(r["when"]), now)} for r in ci]
        bits = [f"{data['scanned']} repos in ~/code"]
        if data["no_ci"]:
            bits.append(f"{data['no_ci']} have no CI")
        if data["missing"]:
            bits.append(f"{data['missing']} not readable on GitHub")
        if len(data["ci"]) > MOST_CI:
            bits.append(f"{len(data['ci']) - MOST_CI} more not shown")
        out[p("ci_note")] = ", ".join(bits) + "."
        out[p("issues")] = [{"ref": r["ref"], "title": clip(r["title"], 50), "age": ago(parse_time(r["updated"]), now)}
                            for r in data["issues"][:MOST_ISSUES]]
        shown_issues, assigned = len(out[p("issues")]), data.get("issues_total", 0)
        if "issues" in data.get("lost", []):
            out[p("issue_note")] = "GitHub didn't send your assigned issues. Trying again in a minute."
        elif not assigned:
            out[p("issue_note")] = "No open issues assigned to you."
        elif assigned > shown_issues:
            out[p("issue_note")] = f"{assigned} assigned, newest {shown_issues} shown, {assigned - shown_issues} more not shown."
        else:
            out[p("issue_note")] = f"{assigned} assigned."
        return out

    def detail(self, ctx: Context, data, values: dict) -> Result:
        """A row's Checks button: show that PR below. Runs nothing."""
        row_id = str(values.get("row") or "")
        rows = [r for r in ((data or {}).get("needs") or [])[:MOST_NEEDS] if r["id"] == row_id]
        if len(rows) != 1:
            return Result(False, "That PR isn't on the list any more.")
        return Result(True, f"Showing {rows[0]['ref']}.", updates={self.p("pick"): rows[0]["label"]})
