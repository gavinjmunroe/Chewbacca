"""The rerank model call over HTTPS to the Messages API, skipping `claude -p` start-up.

src/rerank.py calls the claude CLI, which costs about 5s of start-up before the
model sees anything. This sends the same kind of request straight to
api.anthropic.com: each candidate's path plus one short passage, with the
instructions in a cached system block.

The key comes from ANTHROPIC_API_KEY, else the login keychain entry of the same
name (the kit's convention, as with TYPESAFE_API_KEY). It is never printed or
logged. Brain text goes to Anthropic and nowhere else; the host is fixed.
"""
import json, os, subprocess, time, urllib.request

from rerank import Result, parse, snippets

HOST = "https://api.anthropic.com"
MODEL = os.environ.get("BRAIN_RERANK_API_MODEL", "claude-haiku-4-5")

INSTRUCTIONS = (
    "You rank files from a personal notes archive by whether they answer a question. "
    "A file answers it if it states the fact, decision, person or event asked about, "
    "not merely the same topic. Reply with one JSON object and nothing else: "
    "{\"ranking\": [ids]} with up to 10 ids, the best answer first. Leave out files that do not help.")


def api_key():
    k = os.environ.get("ANTHROPIC_API_KEY")
    if k:
        return k
    try:
        return subprocess.run(["/usr/bin/security", "find-generic-password", "-s",
                               "ANTHROPIC_API_KEY", "-w"], capture_output=True, text=True,
                              timeout=5).stdout.strip() or None
    except Exception:
        return None


def build(query, names, snips):
    lines = [f"Question: {query}", ""]
    for i, f in enumerate(names, 1):
        s = snips.get(f) or [""]
        lines.append(f"[{i}] {f} :: {s[0]}")
    return "\n".join(lines)


def rerank(query, names, rows, dense, n=30, chars=200, timeout=3.0, key=None, **_):
    t0 = time.time()
    head = list(names[:n])
    key = key or api_key()
    if not key or len(head) < 2:
        return Result(list(names), False, "no key" if not key else "too few", 0.0, False)
    body = {"model": MODEL, "max_tokens": 80,
            "system": [{"type": "text", "text": INSTRUCTIONS,
                        "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": build(query, head, snippets(head, rows, dense, 1, chars))}]}
    req = urllib.request.Request(HOST + "/v1/messages", data=json.dumps(body).encode(), headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            out = json.loads(r.read())
        text = "".join(b.get("text", "") for b in out.get("content", []))
        ids = parse(text, len(head))
    except Exception as e:  # timeout, HTTP error, bad JSON: stage one stands
        return Result(list(names), False, type(e).__name__, time.time() - t0, False)
    picked = [head[i - 1] for i in ids]
    rest = [f for f in names if f not in set(picked)]
    return Result(picked + rest, True, "", time.time() - t0, False)
