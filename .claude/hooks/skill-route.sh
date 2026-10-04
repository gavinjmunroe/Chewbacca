#!/bin/sh
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
# The detached child that embeds the skill catalog gets no watchdog: a cold
# model load plus ~120 descriptions overruns the 5s a live prompt is allowed.
type hook_init >/dev/null 2>&1 && hook_init skill-route.sh "$([ -n "${SKILL_ROUTE_BUILD_CACHE:-}" ] && echo 0 || echo 5)"
# Name the skill that already covers this request, at the moment it is typed.
#
# THE FAILURE THIS EXISTS FOR, 2026-09-21. Caleb: "Chewbacca's resourcefulness
# and use of agents is so retarded didn't we build a whole graph engineering
# knowledge base bruh". He was right. A session had just hand-written two
# subagent prompts with no verifier and no stop rule, and had run GROUP BY over
# a million-row people-and-orgs file, while skills/graph-engineering sat in the
# repo holding both: a task-graph reference whose first rule is that the
# verification node is non-negotiable, and a nine-stage pipeline whose stage 8
# is the exact deduplication problem the client had called hard.
#
# Thirty-two skills were installed. Zero were named. kit-route.sh routes to
# KITS and was never registered either, so nothing on the machine ever pointed
# at a skill when work started.
#
# Every SKILL.md already carries a description written to be routed on:
# skill-scan spends 25 of its 100 points on "will the description route to this
# skill at all". The descriptions were fine. Nothing read them.
#
# Same contract as kit-route.sh: deterministic, model-free, silent unless there
# is a real match. Silence is the common case and costs nothing. A router that
# speaks on every prompt is one that gets tuned out inside a week, which is the
# failure it exists to prevent.

SKILL_ROUTE_PAYLOAD=$(cat)
export SKILL_ROUTE_PAYLOAD
export SKILL_ROUTE_SELF="${BASH_SOURCE[0]}"

exec python3 <<'PY'
import atexit, json, os, re, sys


def route_shadow(row):
    """Append one row to ~/.chewbacca/state/route-shadow.jsonl. Never raises.

    Shared verbatim with skill-route.sh, because install.sh copies only *.sh
    into ~/.claude/hooks and a helper module would not arrive. The log holds
    the start of every typed prompt, so it must never land in a git work tree:
    any ancestor holding .git makes this refuse, whatever path it was handed.
    ROUTE_SHADOW_LOG overrides the path, which is how the suite keeps test
    prompts out of the real log."""
    try:
        import hashlib, time
        path = os.environ.get("ROUTE_SHADOW_LOG") or os.path.join(
            os.environ.get("CHEWBACCA_HOME") or "~/.chewbacca", "state", "route-shadow.jsonl")
        path = os.path.realpath(os.path.expanduser(path))
        probe = os.path.dirname(path)
        while True:
            if os.path.exists(os.path.join(probe, ".git")):
                return
            parent = os.path.dirname(probe)
            if parent == probe:
                break
            probe = parent
        # 20 MB is years of prompts at a few hundred bytes a row; past it the
        # log stops growing rather than eating the disk. Guessed, never measured.
        if os.path.exists(path) and os.path.getsize(path) > 20_000_000:
            return
        prompt = row.pop("prompt", "") or ""
        row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
               "prompt_sha": hashlib.sha256(prompt.encode()).hexdigest()[:16],
               "prompt80": " ".join(prompt.split())[:80], **row}
        row["id"] = hashlib.sha256(f"{row['ts']}|{row['hook']}|{prompt}|{os.getpid()}"
                                   .encode()).hexdigest()[:12]
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(fd, (json.dumps(row, separators=(",", ":")) + "\n").encode())
        finally:
            os.close(fd)
    except BaseException:
        pass


try:
    payload = json.loads(os.environ.get("SKILL_ROUTE_PAYLOAD") or "{}")
except Exception:
    raise SystemExit(0)

prompt = (payload.get("prompt") or "").strip()
# One row per prompt in the private shadow log, silent prompts included, so
# VEC_MIN and VEC_GATE can be set from labeled real traffic (bin/route-label,
# tools/route_tune.py). The detached child that only builds the vector cache
# is not a prompt and logs nothing.
SHADOW = {"hook": "skill-route", "session_id": str(payload.get("session_id") or ""),
          "prompt": prompt, "gate": "", "method": "", "threshold": None,
          "gate_threshold": None, "candidates": [], "shown": [], "required": []}
if not os.environ.get("SKILL_ROUTE_BUILD_CACHE"):
    atexit.register(lambda: route_shadow(dict(SHADOW)))
# Too short to match on, or a slash command the person already chose.
if len(prompt) < 12 or prompt.startswith("/"):
    SHADOW["gate"] = "short-or-slash"
    raise SystemExit(0)

# Machine traffic is not a request. On its first live firing, 2026-09-21, this
# routed a background-task completion notice to skill-creator. A notification
# is prose about the tooling, so it is full of words like test, run and file,
# and it will match something almost every time. Nobody asked it anything.
NOISE = ("SYSTEM NOTIFICATION", "task-notification", "<task-id>",
         "exited with code", "hookSpecificOutput", "task notification")
if any(marker in prompt for marker in NOISE):
    SHADOW["gate"] = "machine"
    raise SystemExit(0)

ROOTS = [os.path.join(os.path.expanduser(os.environ.get("CHEWBACCA_HOME", "~/.chewbacca")), "skills"),
         os.path.expanduser("~/.claude/skills"),
         os.path.expanduser("~/.agents/skills")]
if os.environ.get("CHEWBACCA_SKILLS_DIR"):
    ROOTS.append(os.environ["CHEWBACCA_SKILLS_DIR"])
here = payload.get("cwd") or os.getcwd()
d = here
for _ in range(5):
    cand = os.path.join(d, "skills")
    if os.path.isdir(cand):
        ROOTS.append(cand)
        break
    parent = os.path.dirname(d)
    if parent == d:
        break
    d = parent

STOP = {
    "a","an","and","the","or","for","to","of","in","on","at","my","me","i","is",
    "it","that","this","with","about","from","was","were","be","been","have",
    "has","had","do","does","did","not","no","any","some","them","they","their",
    "something","anything","someone","somebody","need","needs","want","help",
    "get","getting","one","what","when","where","how","why","who","which","use",
    "using","user","make","made","build","see","also","its","you","your","are",
    "can","could","should","would","will","just","like","more","most","than",
    "into","over","out","up","down","then","there","here","other","same","new",
    # Added 2026-09-29: "but", "every", "went" and "person" routed a feature
    # idea about trip opt-outs to graph-engineering, which teaches the model
    # to ignore the router. Conversational glue, never a topic.
    "but","every","went","person","people","maybe","couldn","thing","things",
}

def stems(text):
    """Crude 5-character stemming, same as kit-route. Collapses extract,
    extraction and extracting, which is the whole point: a description says
    "extract entities" and the person types "extracting people"."""
    out = set()
    for w in re.findall(r"[a-z][a-z0-9'-]+", text.lower()):
        if w in STOP or len(w) < 3:
            continue
        out.add(w[:5])
    return out

def stem_seq(text):
    out = []
    for w in re.findall(r"[a-z][a-z0-9'-]+", text.lower()):
        if w in STOP or len(w) < 3:
            continue
        out.append(w[:5])
    return out

def bigrams(seq):
    return {(seq[i], seq[i + 1]) for i in range(len(seq) - 1)}

# Words that are common in any description of software work and therefore say
# nothing about WHICH skill. Rarity weighting alone cannot catch these: across
# 104 installed skills, `test` and `users` are each claimed by exactly one, so
# they score as maximally distinctive while carrying no routing information.
# That pair alone put a task-completion notice into skill-creator.
#
# A match needs at least one hit from outside this set. Generic words can still
# add weight, they just cannot carry a route on their own.
GENERIC = {
    "test", "tests", "run", "runs", "file", "files", "code", "work", "data",
    "user", "users", "time", "take", "never", "refer", "scrip", "him",
    "proje", "conte", "outpu", "input", "comma", "scrip", "tool", "tools",
    "task", "tasks", "check", "add", "creat", "updat", "chang", "resul",
    "syste", "proce", "sessi", "promp", "agent", "claud",
}

def frontmatter(path):
    """name and description out of the YAML head, without a yaml dependency.
    The description is often multi-line and quoted, so this joins continuation
    lines until the next top-level key."""
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read(8000)
    except OSError:
        return None, None
    if not text.startswith("---"):
        return None, None
    head = text.split("---", 2)
    if len(head) < 3:
        return None, None
    body = head[1]
    name = desc = None
    key = None
    for line in body.split("\n"):
        m = re.match(r"^([a-zA-Z_-]+):\s*(.*)$", line)
        if m:
            key, val = m.group(1), m.group(2)
            if key == "name":
                name = val.strip().strip("'\"")
            elif key == "description":
                desc = val.strip().strip("'\"")
            continue
        if key == "description" and line.strip():
            desc = (desc or "") + " " + line.strip().strip("'\"")
    return name, desc

skills = []
seen = set()
for root in ROOTS:
    if not os.path.isdir(root):
        continue
    for entry in sorted(os.listdir(root)):
        sk = os.path.join(root, entry, "SKILL.md")
        if not os.path.isfile(sk) or entry in seen:
            continue
        name, desc = frontmatter(sk)
        if not name or not desc:
            continue
        seen.add(entry)
        skills.append((name, desc, sk))

if not skills:
    SHADOW["gate"] = "no-skills"
    raise SystemExit(0)

# Meaning first, keywords as the fallback. Added 2026-10-03.
#
# The stem matcher below routed "design an agentic pipeline ... vector
# database ... python" to xlsx on pipel, pytho and datab, and gated tool calls
# on graph-engineering three times in one session for prompts that only shared
# words with it. Scored on the blind 40-case calibration set from 2026-09-26,
# the stem matcher got 29/40. embeddinggemma (local, via Ollama) over
# "name: description" got 34/40 with its threshold chosen leave-one-out, and
# 9/12 against the stem matcher's 8/12 on the separate 12-case dev fixture.
# nomic-embed-text tied the stem matcher at 29 and mxbai reached 31, which is
# why the model is this one.
#
# VEC_MIN is the threshold all 40 leave-one-out folds converged near. Below it
# the router says nothing, which is right for "what's the weather" and the
# other no-skill cases that made up 18 of the 40.
VEC_MODEL = "embeddinggemma"
VEC_MIN = float(os.environ.get("SKILL_ROUTE_VEC_MIN", "0.34"))
VEC_QUERY = "task: search result | query: "

def _embed(texts, timeout):
    import urllib.request
    req = urllib.request.Request(
        os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/") + "/api/embed",
        data=json.dumps({"model": VEC_MODEL, "input": texts, "keep_alive": "30m"}).encode(),
        headers={"Content-Type": "application/json"})
    out = json.load(urllib.request.urlopen(req, timeout=timeout))["embeddings"]
    return [_unit(v) for v in out]

def _unit(v):
    n = sum(x * x for x in v) ** 0.5 or 1.0
    return [x / n for x in v]

def vector_route():
    """[(cos, name, path)] best first, [] to abstain, None when unavailable.

    Skill vectors are cached by a hash of the catalog text, so a new or edited
    SKILL.md re-embeds once. A cold cache is built in a detached child and this
    prompt falls back to keywords: embedding ~120 descriptions while the model
    loads can take longer than the hook's budget."""
    import hashlib, subprocess
    docs = [f"{n}: {d}" for n, d, _p in skills]
    key = hashlib.sha256((VEC_MODEL + "\n" + "\n".join(docs)).encode()).hexdigest()[:16]
    cache_dir = os.path.join(os.path.expanduser(os.environ.get("CHEWBACCA_HOME", "~/.chewbacca")), "cache")
    cache = os.path.join(cache_dir, f"skill-vectors-{key}.json")
    if os.environ.get("SKILL_ROUTE_BUILD_CACHE") == cache:
        os.makedirs(cache_dir, exist_ok=True)
        vecs = _embed(docs, 120)
        tmp = cache + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(vecs, fh)
        os.replace(tmp, cache)
        raise SystemExit(0)
    try:
        with open(cache) as fh:
            vecs = json.load(fh)
    except (OSError, ValueError):
        if not os.path.exists(cache + ".tmp"):
            env = dict(os.environ, SKILL_ROUTE_BUILD_CACHE=cache)
            subprocess.Popen(["bash", os.environ.get("SKILL_ROUTE_SELF", "")], env=env,
                             stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True
                             ).stdin.write(json.dumps(payload).encode())
        return None
    if len(vecs) != len(skills):
        return None
    try:
        q = _embed([VEC_QUERY + prompt[:2000]], 1.5)[0]
    except Exception:
        return None
    scored = sorted(((sum(a * b for a, b in zip(q, v)), i) for i, v in enumerate(vecs)), reverse=True)
    SHADOW["candidates"] = [{"name": skills[i][0], "score": round(c, 4)} for c, i in scored[:3]]
    return [(c, skills[i][0], skills[i][2]) for c, i in scored[:2] if c >= VEC_MIN][:1]

vec = None if os.environ.get("SKILL_ROUTE_NO_VECTOR") else vector_route()
SHADOW["method"] = "stem" if vec is None else "vector"
SHADOW["threshold"] = None if vec is None else VEC_MIN

prompt_stems = stems(prompt)
prompt_bigrams = bigrams(stem_seq(prompt))

# A stem claimed by many skills carries no routing information. "mac" appears
# in nine of them here and picks nothing.
claims = {}
for _n, desc, _p in skills:
    for s in stems(desc):
        claims[s] = claims.get(s, 0) + 1

best = []
if vec is not None:
    best = [(c, name, path, [f"meaning {c:.2f}"]) for c, name, path in vec]
for name, desc, path in ([] if vec is not None else skills):
    d_stems = stems(desc)
    hits = prompt_stems & d_stems
    if not hits:
        continue
    phrase_hit = bool(prompt_bigrams & bigrams(stem_seq(desc)))
    distinctive = {h for h in hits if claims.get(h, 0) == 1}

    # Rarity weighting, not a distinctive/not-distinctive flag. Tuned against
    # 12 real prompts on 2026-09-21.
    #
    # Counting only stems claimed by exactly one skill made overlapping skills
    # cancel each other out: "why is my build failing with a null pointer
    # error" hits `error` and `faili`, both claimed by debugging AND mac-debug,
    # so neither was distinctive and the router said nothing at all. Two
    # skills claiming a stem is strong evidence. Nine claiming it is none.
    #
    # So each hit is worth 1/k where k is how many skills claim it, and the
    # floor is 0.8. A single stem nobody else uses clears it alone; two stems
    # shared with one other skill clear it together; four stems that everything
    # claims do not, which is the case that used to produce noise.
    # Two hits minimum, always. One rare stem clearing the floor by itself is
    # how "why is my build failing with a null pointer error" routed to the
    # demo skill: 5-character stemming turns `pointer` into `point`, which only
    # demo's description uses, so it scored 1.0 off a single word that had
    # nothing to do with the request. A lone stem is a coincidence; two is a
    # topic.
    #
    # 0.7 rather than 0.8: the live skill set under ~/.claude/skills is larger
    # than the repo's, so every stem is claimed more often and the same match
    # scores lower there than in a repo-only test.
    weight = sum(1.0 / claims.get(h, 1) for h in hits)
    specific = hits - GENERIC
    strong = (
        len(hits) >= 2
        and specific
        and (weight >= 0.7 or phrase_hit)
    )
    if not strong:
        continue
    score = weight * 10 + (10 if phrase_hit else 0)
    why = sorted(hits, key=lambda h: claims.get(h, 1))[:4]
    best.append((score, name, path, why))

best.sort(reverse=True)
if vec is None:
    # Stem scores are weight*10 plus a phrase bonus, not cosines. Logged so
    # the fallback's rows can be told apart and left out of a cosine sweep.
    SHADOW["candidates"] = [{"name": n, "score": round(sc, 4)} for sc, n, _p, _w in best[:3]]
if not best:
    raise SystemExit(0)

top = best[:2]
SHADOW["shown"] = [name for _s, name, _p, _w in top]

lines = []
for score, name, path, why in top:
    short = path.replace(os.path.expanduser("~"), "~")
    because = ", ".join(why) if why else "topic overlap"
    lines.append(f"  {name}  ({short})  matched on: {because}")

# ENFORCED skills: a match writes a marker that skill-gate.sh turns into a
# refusal on the first tool call, until the skill is actually loaded.
#
# 2026-09-29: graph-engineering was named by this router on several prompts in
# one session and skipped every time, and Caleb had to say "Graph engineer bro,
# why do I keep having to tell you? Fix chewbacca". The same skip is in memory
# from 2026-09-21 (feedback_fan_out_dont_read_serially). An advisory line that
# was ignored twice is a log line, so for these skills it becomes a gate.
ENFORCED = {"graph-engineering"}
# A meaning match only gates when it is clear of the noise floor. On
# 2026-10-03 "design an agentic pipeline with a vector database" matched the
# video skill at 0.35, one hundredth over VEC_MIN: fine as a suggestion the
# model can wave off, wrong as a refusal. 0.45 is guessed, never measured.
VEC_GATE = 0.45
required = [name for s, name, _p, _w in top
            if name in ENFORCED and (vec is None or s >= VEC_GATE)]
SHADOW["gate_threshold"] = VEC_GATE
SHADOW["required"] = required
sid = re.sub(r"[^A-Za-z0-9_-]", "", str(payload.get("session_id") or ""))
if required and sid:
    state = os.path.join(os.path.expanduser(os.environ.get("CHEWBACCA_HOME", "~/.chewbacca")), "state")
    try:
        os.makedirs(state, exist_ok=True)
        with open(os.path.join(state, f"skill-required-{sid}"), "w") as fh:
            fh.write("\n".join(required) + "\n")
    except OSError:
        pass

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": (
            "A skill in this kit already covers this request. Read it before "
            "deciding an approach, because it holds the failures that were "
            "already paid for:\n"
            + "\n".join(lines)
            + "\nLoad it with the Skill tool. If on reading it the skill "
              "clearly does not fit, say so in one line and carry on."
        ),
    }
}))
PY
