#!/usr/bin/env python3
"""Build a client case study where every number carries its source and the math is computed, not typed.

    case-study build story.json [--out page.md] [--html page.html]
    case-study check story.json
    case-study template

Agency case studies print a headline like "94% less time" with no way to check it. Here the
before and after values go in with a source each, and the tool computes the change. A range
in stays a range out (4 to 8 hours down to 0.5 is 88 to 94% less, never just the flattering
end). It refuses to build when a number has no source, when a quote or the client's name has
no recorded permission, or when a typed headline disagrees with the computed one.
"""
import argparse
import html
import json
import sys


def _die(msg):
    print(f"case-study: {msg}", file=sys.stderr)
    sys.exit(2)


def _range(v, what):
    """A number or [low, high]. Returns (low, high)."""
    if isinstance(v, bool):
        _die(f"{what}: must be a number or [low, high]")
    if isinstance(v, (int, float)):
        return float(v), float(v)
    if isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v):
        lo, hi = float(min(v)), float(max(v))
        return lo, hi
    _die(f"{what}: must be a number or [low, high]")


def _fmt(x):
    return f"{x:,.0f}" if abs(x - round(x)) < 1e-9 else f"{x:,.1f}"


def _span(lo, hi, unit=""):
    u = f" {unit}" if unit else ""
    return f"{_fmt(lo)}{u}" if lo == hi else f"{_fmt(lo)} to {_fmt(hi)}{u}"


def problems(story):
    """Every reason this story can't be published, as plain sentences. Empty means clean."""
    out = []
    if not isinstance(story, dict):
        return ["the story must be a JSON object"]
    perm = story.get("permission") or {}
    if story.get("client") and not perm.get("name"):
        out.append("client is named but permission.name has no record (who said yes, and when)")
    for i, m in enumerate(story.get("metrics") or []):
        label = m.get("name") or f"metric {i + 1}"
        if not str(m.get("source") or "").strip():
            out.append(f"{label}: no source")
        if m.get("before") is None or m.get("after") is None:
            out.append(f"{label}: needs both before and after")
    for i, v in enumerate(story.get("value") or []):
        if not str(v.get("source") or "").strip():
            out.append(f"{v.get('label') or f'value {i + 1}'}: no source")
    q = story.get("quote")
    if q:
        if not perm.get("quote"):
            out.append("quote has no permission.quote record")
        if not str(q.get("source") or "").strip():
            out.append("quote: no source")
    if not story.get("metrics"):
        out.append("no metrics: a case study with no before and after is a testimonial")
    return out


def compute(m):
    """Change for one metric. lower_is_better defaults true (time, cost, errors)."""
    blo, bhi = _range(m["before"], f"{m.get('name')}.before")
    alo, ahi = _range(m["after"], f"{m.get('name')}.after")
    if blo <= 0:
        _die(f"{m.get('name')}: before must be above zero to compute a change")
    lower_better = m.get("lower_is_better", True)
    # Worst and best case pairings, so the range is honest at both ends.
    pairs = [(bhi, alo), (blo, ahi), (blo, alo), (bhi, ahi)]
    pct = [((b - a) / b * 100) if lower_better else ((a - b) / b * 100) for b, a in pairs]
    lo, hi = min(pct), max(pct)
    word = "less" if lower_better else "more"
    pct_text = f"{round(lo)}% {word}" if round(lo) == round(hi) else f"{round(lo)} to {round(hi)}% {word}"
    typed = m.get("headline_pct")
    if typed is not None and not (round(lo) - 0.5 <= typed <= round(hi) + 0.5):
        _die(f"{m.get('name')}: typed headline {typed}% is outside the computed {pct_text}")
    return {"name": m["name"], "before": _span(blo, bhi, m.get("unit", "")),
            "after": _span(alo, ahi, m.get("unit", "")), "change": pct_text,
            "change_range": [round(lo, 1), round(hi, 1)], "source": m["source"]}


def build(story):
    bad = problems(story)
    if bad:
        _die("not publishable:\n  - " + "\n  - ".join(bad))
    name = story.get("client") or story.get("anonymous_as") or "A client"
    rows = [compute(m) for m in story["metrics"]]
    vals = []
    for v in story.get("value") or []:
        lo, hi = _range(v["amount"], v.get("label"))
        vals.append({"label": v["label"], "amount": "$" + _span(lo, hi), "source": v["source"]})
    return {"title": story.get("title") or f"{name}: {rows[0]['change']} on {rows[0]['name'].lower()}",
            "client": name, "problem": story.get("problem", ""), "built": story.get("built", ""),
            "metrics": rows, "value": vals, "quote": story.get("quote")}


def markdown(page):
    out = [f"# {page['title']}", ""]
    if page["problem"]:
        out += ["## The problem", "", page["problem"], ""]
    if page["built"]:
        out += ["## What we built", "", page["built"], ""]
    out += ["## Before and after", "", "| Metric | Before | After | Change | Source |", "|---|---|---|---|---|"]
    out += [f"| {r['name']} | {r['before']} | {r['after']} | {r['change']} | {r['source']} |" for r in page["metrics"]]
    out.append("")
    if page["value"]:
        out += ["## Value", ""] + [f"- {v['label']}: {v['amount']} ({v['source']})" for v in page["value"]] + [""]
    q = page.get("quote")
    if q:
        out += [f"> {q['text']}", ">", f"> {q['who']}", ""]
    out.append("Every change above is computed from the before and after values and their sources, by `case-study build`.")
    return "\n".join(out) + "\n"


def to_html(page):
    e = html.escape
    rows = "".join(f"<tr><td>{e(r['name'])}</td><td>{e(r['before'])}</td><td>{e(r['after'])}</td>"
                   f"<td><strong>{e(r['change'])}</strong></td><td>{e(r['source'])}</td></tr>" for r in page["metrics"])
    vals = "".join(f"<li>{e(v['label'])}: {e(v['amount'])} <span class=src>{e(v['source'])}</span></li>" for v in page["value"])
    q = page.get("quote")
    quote = f"<blockquote><p>{e(q['text'])}</p><cite>{e(q['who'])}</cite></blockquote>" if q else ""
    sec = lambda h, b: f"<h2>{h}</h2><p>{e(b)}</p>" if b else ""
    return ("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>{e(page['title'])}</title><style>"
            ":root{--bg:#f6f5f1;--ink:#1c1b19;--muted:#6b6862;--line:#dedbd3;--accent:#2f5d50}"
            "body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,'Inter',sans-serif}"
            "main{max-width:44rem;margin:0 auto;padding:3rem 1rem}h1{font-size:2rem;line-height:1.15}"
            "table{width:100%;border-collapse:collapse;font-size:.92rem}td,th{border-bottom:1px solid var(--line);padding:.5rem .4rem;text-align:left}"
            "strong{color:var(--accent)}.src{color:var(--muted);font-size:.85rem}"
            "blockquote{border-left:3px solid var(--accent);margin:2rem 0;padding:.2rem 1rem}cite{color:var(--muted)}"
            "@media (max-width:540px){table{display:block;overflow-x:auto}}"
            f"</style><main><h1>{e(page['title'])}</h1>{sec('The problem', page['problem'])}{sec('What we built', page['built'])}"
            f"<h2>Before and after</h2><table><tr><th>Metric</th><th>Before</th><th>After</th><th>Change</th><th>Source</th></tr>{rows}</table>"
            + (f"<h2>Value</h2><ul>{vals}</ul>" if vals else "") + quote + "</main></html>\n")


TEMPLATE = {
    "client": "", "anonymous_as": "A 25-person engineering firm",
    "permission": {"name": "", "quote": ""},
    "problem": "Each payroll took hours of manual reconciliation across three systems.",
    "built": "An app that reads the payroll export, allocates hours to jobs and writes an accounting-ready file.",
    "metrics": [{"name": "Time per payroll", "unit": "hours", "before": [4, 8], "after": 0.5,
                 "lower_is_better": True, "source": "owner's timesheet, 6 payrolls before and after"}],
    "value": [{"label": "Software quote avoided", "amount": 30000, "source": "vendor quote, PDF in client folder"}],
}


def main(argv=None):
    p = argparse.ArgumentParser(prog="case-study", description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build"); b.add_argument("story"); b.add_argument("--out"); b.add_argument("--html")
    c = sub.add_parser("check"); c.add_argument("story")
    sub.add_parser("template")
    a = p.parse_args(argv)
    if a.cmd == "template":
        print(json.dumps(TEMPLATE, indent=2)); return 0
    try:
        with open(a.story) as f:
            story = json.load(f)
    except (OSError, ValueError) as err:
        _die(f"can't read {a.story}: {err}")
    if a.cmd == "check":
        bad = problems(story)
        for line in bad:
            print(line)
        if not bad:
            for m in story["metrics"]:
                print(f"{m['name']}: {compute(m)['change']}")
        return 1 if bad else 0
    page = build(story)
    md = markdown(page)
    if a.html:
        with open(a.html, "w") as f:
            f.write(to_html(page))
    if a.out:
        with open(a.out, "w") as f:
            f.write(md)
    if not a.out and not a.html:
        sys.stdout.write(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
