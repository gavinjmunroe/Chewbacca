#!/usr/bin/env python3
"""Drill GTM engineer interview cases against the distilled Clay procedures.

Offline. No network, no model calls, no Clay session. Every answer is built
from three files in this checkout:

  skills/gtme-interview/evals/evals.json           the case bank
  library/learning/clay-navigation/WALKTHROUGHS.md the sourced procedures
  library/clay-api/registry.json                   the ops `chewbacca clay` runs

  gtme-interview                       a random case: retrieve, build, grade, time
  gtme-interview ask "question"        answer a question you were just asked
  gtme-interview show <case-id>        one case's answer card
  gtme-interview check <case-id> --answer "..."   grade your own answer
  gtme-interview bench [--json]        every case and its paraphrase, timed
  gtme-interview list                  case ids and prompts
"""

import argparse
import importlib.util
import json
import math
import random
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CASES = ROOT / "skills/gtme-interview/evals/evals.json"
PROCEDURES = ROOT / "library/learning/clay-navigation/WALKTHROUGHS.md"
REGISTRY = ROOT / "library/clay-api/registry.json"

# Caleb's bar, 2026-10-10: "chewb gotta mog and do those in 2 sec". The budget
# covers retrieval plus building the answer card, measured in process; Python
# startup is reported separately by `bench` because it is not the answer path.
BUDGET_MS = 2000

# A key point counts when any one of its match strings appears in the answer.
# 0.7 means a grader would accept most of the points with one or two missing;
# the model answers in the bank all score 1.0, which the test asserts.
PASS_SCORE = 0.7

STOP = {
    "the", "and", "for", "you", "your", "with", "that", "this", "how", "what", "would",
    "are", "our", "out", "from", "into", "get", "use", "why", "when", "who", "does",
    "can", "will", "them", "they", "need", "want", "make", "have", "has", "all", "any",
    "one", "its", "not", "but", "then", "than", "over", "about", "there", "here", "me",
    "clay", "walk", "through", "tell",
}


def stem(word):
    for suffix in ("ing", "ers", "ies", "ed", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)]
    return word


def tokens(text):
    return [stem(w) for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2 and w not in STOP]


def load_cases(path=CASES):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return data["cases"]


def load_procedures(path=PROCEDURES):
    """Parse WALKTHROUGHS.md into {id: {title, body, kit, source}}."""
    entries, current = {}, None
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        head = re.match(r"^### (W-\d{3}) (.+)$", line)
        if head:
            current = {"id": head.group(1), "title": head.group(2).strip(), "lines": []}
            entries[current["id"]] = current
            continue
        if line.startswith("## "):
            current = None
            continue
        if current is not None and line.strip():
            current["lines"].append(line.strip())
    for entry in entries.values():
        body = "\n".join(entry.pop("lines"))
        entry["body"] = body
        kit = re.search(r"^- Kit: `([a-z-]+)`", body, re.M)
        entry["kit"] = kit.group(1) if kit else None
        # The last Source line is the citation; a step can itself begin with
        # "Source:" when it describes a Clay source (W-012 does).
        sources = re.findall(r"^- Source: (.+)$", body, re.M)
        entry["source"] = sources[-1].strip() if sources else None
    return entries


def load_registry(path=REGISTRY):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    ops = {o["name"]: {"kind": o.get("kind"), "args": o.get("args", [])} for o in data.get("ops", [])}
    for o in data.get("ui_only", []):
        ops[o["name"]] = {"kind": "ui", "args": []}
    for o in data.get("untaught_writes", []):
        ops[o["name"]] = {"kind": "untaught", "args": []}
    # Verbs of `chewbacca clay` itself rather than Clay jobs (bin/chewbacca-clay).
    for verb in ("ops", "doctor", "measure"):
        ops.setdefault(verb, {"kind": "meta", "args": []})
    return ops


def clay_ops_in(text):
    """Every op named as `chewbacca clay <op>` in a block of text."""
    return re.findall(r"chewbacca clay ([a-z][a-z-]*)", text)


def validate_command(command, registry):
    """Say whether a command the answer card prints would run in this kit."""
    match = re.match(r"chewbacca clay ([a-z][a-z-]*)(.*)$", command)
    if match:
        op, rest = match.group(1), match.group(2)
        if op not in registry:
            return {"command": command, "ok": False, "why": f"no clay op named {op}"}
        given = set(re.findall(r"\b([a-z_]+)=", rest))
        allowed = {a.rstrip("?") for a in registry[op]["args"]}
        unknown = sorted(given - allowed) if allowed else sorted(given) if registry[op]["kind"] in ("ui", "untaught") else []
        return {"command": command, "ok": not unknown, "kind": registry[op]["kind"],
                "why": f"unknown args {unknown}" if unknown else ""}
    tool = command.split()[0]
    if tool.startswith("gtme-"):
        exists = (ROOT / "bin" / tool).is_file()
        return {"command": command, "ok": exists, "kind": "offline tool",
                "why": "" if exists else f"no bin/{tool}"}
    return {"command": command, "ok": True, "kind": "other", "why": ""}


class Index:
    """Weighted token overlap over cases and procedures. Small, exact, instant."""

    def __init__(self, cases, procedures):
        self.cases, self.procedures = cases, procedures
        self.docs = []
        # A case document is the case's own words only: prompt, answer, build
        # steps, key points and its procedures' titles. Paraphrases stay out,
        # because `bench` uses them as the unseen questions; indexing them
        # would grade retrieval on its own answer key.
        # Fields carry weights: the question a case answers says more about
        # what it is for than the words of its answer do.
        for case in cases:
            fields = [(case["prompt"], 3), (" ".join(p["point"] for p in case["key_points"]), 2),
                      (" ".join(procedures[p]["title"] for p in case["procedures"] if p in procedures), 2),
                      (" ".join(case.get("build", [])), 1), (case["model_answer"], 1)]
            self.docs.append(("case", case["id"], self.weigh(fields)))
        for pid, entry in procedures.items():
            self.docs.append(("procedure", pid, self.weigh([(entry["title"], 3), (entry["body"], 1)])))
        df = {}
        for _, _, weights in self.docs:
            for t in weights:
                df[t] = df.get(t, 0) + 1
        n = len(self.docs)
        self.idf = {t: math.log((n + 1) / (c + 0.5)) for t, c in df.items()}

    @staticmethod
    def weigh(fields):
        weights = {}
        for text, weight in fields:
            for t in tokens(text):
                weights[t] = max(weights.get(t, 0), weight)
        return weights

    def search(self, question, kind=None, limit=5):
        query = set(tokens(question))
        scored = []
        for doc_kind, doc_id, weights in self.docs:
            if kind and doc_kind != kind:
                continue
            overlap = query & weights.keys()
            score = sum(self.idf.get(t, 0) * weights[t] for t in overlap) / math.sqrt(sum(weights.values()) + 10)
            if score > 0:
                scored.append((score, doc_kind, doc_id))
        scored.sort(key=lambda s: (-s[0], s[2]))
        return scored[:limit]


def load_math():
    spec = importlib.util.spec_from_file_location("gtme_math", ROOT / "tools/gtme_math.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def compute(case):
    """Run a case's offline computation in process, the kit's dry run."""
    spec = case.get("compute")
    if not spec:
        return None
    if spec["tool"] != "gtme-math" or spec["op"] not in ("order", "funnel"):
        return {"ok": False, "why": f"unsupported compute {spec['tool']} {spec['op']}"}
    result = getattr(load_math(), spec["op"])(spec["input"])
    ok = True
    for key, want in spec.get("expect", {}).items():
        got = result.get(key)
        ok = ok and (abs(got - want) < 1e-9 if isinstance(want, float) else got == want)
    return {"ok": ok, "op": spec["op"], "result": result}


def grade(case, answer):
    text = answer.lower()
    hits, misses = [], []
    for point in case["key_points"]:
        (hits if any(m.lower() in text for m in point["match"]) else misses).append(point["point"])
    score = len(hits) / len(case["key_points"])
    return {"score": round(score, 3), "pass": score >= PASS_SCORE, "hit": hits, "missed": misses}


def build_card(case, procedures, registry):
    commands = [validate_command(c, registry) for c in case.get("commands", [])]
    return {
        "id": case["id"],
        "prompt": case["prompt"],
        "answer": case["model_answer"],
        "procedures": [{"id": p, "title": procedures[p]["title"], "kit": procedures[p]["kit"],
                        "source": procedures[p]["source"]} for p in case["procedures"] if p in procedures],
        "missing_procedures": [p for p in case["procedures"] if p not in procedures],
        "build": case.get("build", []),
        "formula": case.get("formula"),
        "commands": commands,
        "compute": compute(case),
    }


def answer_path(question, cases, procedures, registry, index=None):
    """Retrieve the case for a question and build its card, timed."""
    start = time.perf_counter()
    index = index or Index(cases, procedures)
    hits = index.search(question, kind="case", limit=3)
    looked_up = time.perf_counter()
    by_id = {c["id"]: c for c in cases}
    card = build_card(by_id[hits[0][2]], procedures, registry) if hits else None
    built = time.perf_counter()
    related = [pid for _, _, pid in index.search(question, kind="procedure", limit=3)]
    timing = {"lookup_ms": round((looked_up - start) * 1000, 2),
              "build_ms": round((built - looked_up) * 1000, 2),
              "total_ms": round((time.perf_counter() - start) * 1000, 2)}
    return {"question": question, "card": card, "alternates": [h[2] for h in hits[1:]],
            "related_procedures": related, "timing": timing}


def render(result, out=sys.stdout):
    card = result["card"]
    if not card:
        print("No case matched. Closest procedures: " + ", ".join(result["related_procedures"]), file=out)
        return
    print(f"Q: {result['question']}", file=out)
    print(f"Case: {card['id']}" + (f"  (also: {', '.join(result['alternates'])})" if result["alternates"] else ""), file=out)
    print("\nAnswer:\n  " + card["answer"], file=out)
    if card["build"]:
        print("\nBuild:", file=out)
        for i, step in enumerate(card["build"], 1):
            print(f"  {i}. {step}", file=out)
    if card["formula"]:
        print("\nFormula:\n  " + card["formula"], file=out)
    if card["commands"]:
        print("\nCommands (checked against the clay registry, not run):", file=out)
        for c in card["commands"]:
            flag = "ok" if c["ok"] else "BAD"
            print(f"  [{flag}] {c['command']}" + (f"  ({c['why']})" if c["why"] else ""), file=out)
    if card["compute"]:
        comp = card["compute"]
        res = comp.get("result", {})
        if comp.get("op") == "order":
            line = (f"order {' > '.join(res['chosen_order'])}, expected cost "
                    f"{res['chosen_expected_cost']:.2f} vs {res['baseline_expected_cost']:.2f} {res['cost_unit']}")
        elif comp.get("op") == "funnel":
            lo, hi = res["interval"]
            line = f"rate {res['rate']:.3f}, 95% interval {lo:.3f} to {hi:.3f} ({res['method']})"
        else:
            line = comp.get("why", "")
        print(f"\nComputed offline (gtme-math {comp.get('op')}): {line}" + ("" if comp["ok"] else "  MISMATCH"), file=out)
    print("\nProcedures:", file=out)
    for p in card["procedures"]:
        print(f"  {p['id']} {p['title']}  [{p['kit']}]", file=out)
    t = result["timing"]
    print(f"\ntiming: lookup {t['lookup_ms']} ms, build {t['build_ms']} ms, "
          f"total {t['total_ms']} ms (budget {BUDGET_MS} ms)", file=out)


def bench(cases, procedures, registry):
    index_start = time.perf_counter()
    index = Index(cases, procedures)
    index_ms = (time.perf_counter() - index_start) * 1000
    rows = []
    for case in cases:
        for kind in ("prompt", "paraphrase"):
            question = case.get(kind)
            if not question:
                continue
            result = answer_path(question, cases, procedures, registry, index)
            got = result["card"]["id"] if result["card"] else None
            gradeable = grade(case, result["card"]["answer"]) if got == case["id"] else {"score": 0, "pass": False}
            top3 = [got] + result["alternates"]
            rows.append({"case": case["id"], "asked": kind, "retrieved": got, "correct": got == case["id"],
                         "in_top3": case["id"] in top3,
                         "total_ms": result["timing"]["total_ms"], "score": gradeable["score"],
                         "commands_ok": all(c["ok"] for c in result["card"]["commands"]) if result["card"] else False,
                         "compute_ok": (result["card"]["compute"] or {"ok": True})["ok"] if result["card"] else False})
    times = sorted(r["total_ms"] for r in rows)
    para = [r for r in rows if r["asked"] == "paraphrase"]
    return {
        "cases": len(cases), "questions": len(rows),
        "index_build_ms": round(index_ms, 2),
        "p50_ms": times[len(times) // 2], "max_ms": times[-1], "budget_ms": BUDGET_MS,
        "within_budget": times[-1] + index_ms < BUDGET_MS,
        "retrieval_prompt": sum(r["correct"] for r in rows if r["asked"] == "prompt") / len(cases),
        "retrieval_paraphrase": sum(r["correct"] for r in para) / len(para) if para else None,
        "retrieval_paraphrase_top3": sum(r["in_top3"] for r in para) / len(para) if para else None,
        "misses": [r for r in rows if not r["correct"]],
        "rows": rows,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(prog="gtme-interview", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd")
    drill = sub.add_parser("drill", help="a random case, answered, graded and timed (the default)")
    drill.add_argument("--seed", type=int)
    ask = sub.add_parser("ask", help="answer a question")
    ask.add_argument("question")
    show = sub.add_parser("show", help="one case's answer card")
    show.add_argument("case")
    check = sub.add_parser("check", help="grade your answer against a case's key points")
    check.add_argument("case")
    check.add_argument("--answer")
    check.add_argument("--answer-file")
    sub.add_parser("bench", help="time and score every case and paraphrase")
    sub.add_parser("list", help="case ids and prompts")
    for p in (parser, drill, ask, show, check):
        p.add_argument("--json", action="store_true")
    args, rest = parser.parse_known_args(argv)
    if rest == ["--json"]:
        args.json = True
    elif rest:
        parser.error(f"unrecognized arguments: {' '.join(rest)}")

    cases, procedures, registry = load_cases(), load_procedures(), load_registry()
    by_id = {c["id"]: c for c in cases}
    cmd = args.cmd or "drill"

    if cmd == "list":
        for c in cases:
            print(f"{c['id']:28} {c['prompt']}")
        return 0
    if cmd == "bench":
        report = bench(cases, procedures, registry)
        if getattr(args, "json", False):
            print(json.dumps(report, indent=2))
        else:
            print(f"{report['cases']} cases, {report['questions']} questions; index {report['index_build_ms']} ms; "
                  f"answer path p50 {report['p50_ms']} ms, max {report['max_ms']} ms, budget {BUDGET_MS} ms")
            print(f"retrieval: prompts {report['retrieval_prompt']:.0%}, paraphrases top-1 "
                  f"{report['retrieval_paraphrase']:.0%}, top-3 {report['retrieval_paraphrase_top3']:.0%}")
            for m in report["misses"]:
                print(f"  miss: {m['case']} ({m['asked']}) retrieved {m['retrieved']}")
        return 0 if report["within_budget"] and not [r for r in report["rows"] if r["asked"] == "prompt" and not r["correct"]] else 1
    if cmd in ("show", "check") and args.case not in by_id:
        print(f"no case {args.case}; try: gtme-interview list", file=sys.stderr)
        return 2
    if cmd == "check":
        answer = args.answer if args.answer is not None else (
            Path(args.answer_file).read_text(encoding="utf-8") if args.answer_file else sys.stdin.read())
        result = grade(by_id[args.case], answer)
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"{'PASS' if result['pass'] else 'FAIL'} {result['score']:.0%}")
            for m in result["missed"]:
                print(f"  missed: {m}")
        return 0 if result["pass"] else 1
    if cmd == "show":
        question = by_id[args.case]["prompt"]
    elif cmd == "ask":
        question = args.question
    else:
        rng = random.Random(args.seed)
        question = rng.choice(cases)["prompt"]
    result = answer_path(question, cases, procedures, registry)
    if cmd == "drill" and result["card"]:
        result["grade"] = grade(by_id[result["card"]["id"]], result["card"]["answer"])
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        render(result)
        if "grade" in result:
            g = result["grade"]
            print(f"grade of the model answer: {g['score']:.0%} of key points")
    within = result["timing"]["total_ms"] < BUDGET_MS
    return 0 if result["card"] and within else 1


if __name__ == "__main__":
    sys.exit(main())
