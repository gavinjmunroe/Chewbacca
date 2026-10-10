"""Second-stage rerank for brain: a model reads the top candidates and reorders them.

Stage one (brain.rank) is good at getting the right file into the top 50 and
bad at ordering it: see findings/RESULTS.md, 2026-10-10 rerank. This sends the
question plus each candidate's path and best chunks to a model through the
`claude` CLI and puts the files it picks first, in its order, ahead of the rest
in stage-one order.

Privacy: the candidate text goes to Anthropic through the claude CLI and
nowhere else. The cache keeps only the model's ranking, keyed by a hash of the
prompt, never the prompt itself.

Failure is never fatal: a timeout, a non-zero exit or unparseable output
returns stage one's order unchanged with ok=False and the reason.
"""
import collections, hashlib, json, os, re, subprocess, time

MODEL = os.environ.get("BRAIN_RERANK_MODEL", "haiku")
CACHE = os.path.expanduser(os.environ.get("BRAIN_RERANK_CACHE", "~/.cache/chewbacca/brain-rerank"))
CLAUDE = os.environ.get("BRAIN_RERANK_CLAUDE", "claude")

SYSTEM = ("You rank files from a personal notes archive by whether they answer a question. "
          "Reply with one JSON object and nothing else.")

Result = collections.namedtuple("Result", "files ok reason secs cached")


def snippets(names, rows, dense, per=2, chars=450):
    """Each candidate's best `per` chunks by query cosine, in file order."""
    by_file = collections.defaultdict(list)
    want = set(names)
    for r in rows:
        if r[1] in want:
            by_file[r[1]].append(r)
    out = {}
    for f in names:
        rs = by_file.get(f, [])
        if dense is not None:
            rs = sorted(rs, key=lambda r: -float(dense[r[4]]))
        best = sorted(rs[:per], key=lambda r: r[0])
        out[f] = [((r[2] + ": ") if r[2] else "") + " ".join(r[3].split())[:chars] for r in best]
    return out


def build_prompt(query, names, snips):
    lines = [f"Question: {query}", "",
             "Candidate files. Each shows its path and its passages closest to the question.", ""]
    for i, f in enumerate(names, 1):
        lines.append(f"[{i}] {f}")
        for s in snips.get(f, []):
            lines.append(f"    - {s}")
    lines += ["",
              "Which files would someone need to open to answer the question? A file answers it "
              "if it states the fact, decision, person or event asked about, not merely the same topic. "
              "Return {\"ranking\": [ids]} with up to 10 ids, the best answer first. "
              "Leave out files that do not help."]
    return "\n".join(lines)


def parse(text, n):
    """The ranking from a reply that may carry a prayer line or a code fence
    before the JSON: read from the first '{'."""
    i = text.find("{")
    if i < 0:
        raise ValueError("no json")
    obj, _ = json.JSONDecoder().raw_decode(text[i:])
    ids, seen = [], set()
    for x in obj.get("ranking", []):
        try:
            k = int(x)
        except (TypeError, ValueError):
            continue
        if 1 <= k <= n and k not in seen:
            seen.add(k)
            ids.append(k)
    return ids


def call_model(prompt, timeout):
    args = [CLAUDE, "-p", "--model", MODEL, "--tools", "", "--no-session-persistence",
            "--output-format", "json", "--setting-sources", "", "--strict-mcp-config",
            "--disable-slash-commands", "--system-prompt", SYSTEM]
    # cwd outside any project so no CLAUDE.md is discovered; the stripped flags
    # took a probe from ~281k input tokens (refused) to 10.
    p = subprocess.run(args, input=prompt, capture_output=True, text=True,
                       timeout=timeout, cwd=os.path.expanduser("~/.cache") if os.path.isdir(
                           os.path.expanduser("~/.cache")) else "/")
    if p.returncode != 0:
        raise RuntimeError(f"exit {p.returncode}")
    out = json.loads(p.stdout)
    if out.get("is_error"):
        raise RuntimeError("model error")
    return out.get("result") or ""


def rerank(query, names, rows, dense, n=30, per=2, chars=450, timeout=60.0, **_):
    """Reorder stage one's `names`. Returns Result(files, ok, reason, secs, cached)."""
    t0 = time.time()
    head = list(names[:n])
    if len(head) < 2:
        return Result(list(names), True, "too few", 0.0, False)
    prompt = build_prompt(query, head, snippets(head, rows, dense, per, chars))
    key = hashlib.sha256((MODEL + "\0" + SYSTEM + "\0" + prompt).encode()).hexdigest()
    path = os.path.join(CACHE, key[:2], key + ".json")
    ids, cached = None, False
    try:
        with open(path) as fh:
            ids, cached = json.load(fh)["ids"], True
    except (OSError, ValueError, KeyError):
        pass
    if ids is None:
        try:
            ids = parse(call_model(prompt, timeout), len(head))
        except Exception as e:  # timeout, missing CLI, bad JSON: stage one stands
            return Result(list(names), False, type(e).__name__, time.time() - t0, False)
        try:
            os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
            with open(path, "w") as fh:
                json.dump({"ids": ids}, fh)
        except OSError:
            pass
    picked = [head[i - 1] for i in ids]
    rest = [f for f in names if f not in set(picked)]
    return Result(picked + rest, True, "", time.time() - t0, cached)
