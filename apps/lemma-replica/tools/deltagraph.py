#!/usr/bin/env python3
"""The deltas as a typed graph, so the question "what closes the most" is askable.

WHY A GRAPH AND NOT THE TABLE. `docs/DELTAS.md` is 133 flat rows and it can
answer "what differs" perfectly well. It cannot answer "which single change
closes the most rows", because that is a multi-hop question: delta -> cause ->
every other delta sharing that cause. A table forces you to eyeball it, and
eyeballing it is how Wave 1 nearly got worked section by section.

Wave 1 is the proof. Four heading-x deltas, three section-height deltas and
the phantom-section count were ONE cause: our feature blocks were not built on
their 1040/384+544/64 template. Fixing the cause closed eight rows at once. A
section-by-section reading would have chased eight symptoms.

SCHEMA FIRST, EXTRACTION SECOND. The ontology is fixed here in code before any
row is read, because a graph extracted without one is a word cloud with arrows.

    NODES
      delta        one non-matching measured axis on one section
      cause        a structural reason a set of deltas exists
      wave         where a cause is scheduled to be fixed
      artifact     the file a cause lives in

    RELATIONS, each a precise verb with a domain and a range
      delta   CAUSED_BY  cause      never "related to"
      cause   FIXED_IN   wave
      cause   LIVES_IN   artifact
      cause   BLOCKS     cause      ordering between causes

Every node carries provenance: where the fact came from and when. A delta's
source is the measurement file and the viewport it was taken at; a cause's is
the session that found it, because a cause is a judgement and should be
traceable to one.
"""
import json, re, pathlib, sys, datetime, collections

ROOT = pathlib.Path(__file__).resolve().parent.parent
TODAY = datetime.date.today().isoformat()

# --- the causes, hand-modelled ------------------------------------------
# Deliberately not extracted. A cause is a judgement about why a set of
# numbers disagree, and an LLM guessing at that is exactly the "fitting the
# output instead of recovering the generator" failure this project already
# paid for once. Each is written after a measurement that established it.
CAUSES = [
    dict(id="tmpl", wave=2, artifact="src/styles.css",
         name="feature blocks not on their 1040/384+544/64 template",
         found="2026-09-28, walking their DOM from the h2 to the page container",
         matches=lambda s, a: s in FEATURE and a in ("heading x", "heading width")),
    dict(id="shrink", wave=2, artifact="src/styles.css",
         name="centred headings are full-width boxes on ours, shrink-to-fit on theirs",
         found="2026-09-28, hero h1 box 848 against their 340 at identical text",
         matches=lambda s, a: a in ("heading x", "heading width") and s not in FEATURE),
    # CORRECTED 2026-09-28. This said "panels carry a fraction of their
    # content", from their sticky panel holding 504 descendants against our
    # 32 to 169. That compared their whole CONTAINER against our INDIVIDUAL
    # panels. Measured the same way on both:
    #
    #     theirs   sticky container   451-511 descendants   101-121 text leaves
    #     ours     demo stage         359 descendants       122 text leaves
    #
    # Our leaf count already matches theirs, so the information density is
    # there. The descendant gap is markup depth, 4.0 elements per leaf on
    # theirs against 2.9 on ours, which is a wrapper-div difference and not a
    # content one. Only the metrics panel is genuinely thin at 32 descendants
    # and 5 leaves, against 42 to 169 for the other three.
    dict(id="thin", wave=3, artifact="src/app.js",
         name="the metrics panel is thin (5 text leaves against 24 to 60)",
         found="2026-09-28, per-panel leaf counts on both, corrected from a "
               "container-against-panel comparison",
         matches=lambda s, a: a.startswith("largest block")),
    dict(id="short", wave=4, artifact="index.html",
         name="sections below the demo are not built out",
         found="2026-09-28, 735px of the 1348px shortfall sits below the demo",
         matches=lambda s, a: a == "section height"),
    dict(id="lead", wave=2, artifact="src/styles.css",
         name="lead paragraph rhythm is ad hoc",
         found="2026-09-28, theirs is 18px at an 8px gap on every feature block",
         matches=lambda s, a: a.startswith("lead")),
    # DELIBERATE, and it ranks as work if it is not modelled. Their sticky
    # container keeps all four sub-panels in the DOM at every scroll position,
    # so all ~460 of their descendants count as painted in every feature
    # block. Ours sets display:none below 0.01 opacity, so one panel is
    # painted and the rest are out of the tree.
    #
    # Our stage holds 457 descendants against their 451 to 511, so the content
    # is equal. The axis is measuring the optimisation. Keeping it: a panel at
    # opacity 0 still paints its children's stacking context and still traps
    # pointer events, and four of them do it four times over.
    dict(id="hidden", wave=0, artifact="src/app.js", deliberate=True,
         name="offscreen panels are display:none on ours, in the DOM on theirs",
         found="2026-09-28, stage descendants 457 vs 451-511, painted 42 vs 531",
         matches=lambda s, a: a == "painted elements" and s in FEATURE),
    dict(id="svg", wave=3, artifact="src/app.js",
         name="figure element counts differ",
         found="2026-09-28, per-plate node counts on both",
         # "painted elements" was in here and is now claimed by `hidden` on the
         # four feature blocks. Two causes claiming one delta sends it to
         # unmodelled by design, which is why the deliberate cause reported
         # zero rows while looking correct. Outside the feature blocks a
         # painted-element gap is real content, so it belongs to `short`.
         matches=lambda s, a: a in ("svg shapes", "controls")
                 or (a == "painted elements" and s not in FEATURE)),
]
# The four text blocks inside the pinned scene. Keys are the ROLE names
# gendeltas emits, and the last one was still "read the spans / ship with
# confidence" from before the roles were settled, so every rule keyed on this
# set silently skipped one of the four.
FEATURE = {"surface failures", "notifications", "fix where you work / mcp",
           "ship with confidence"}


def parse(path):
    """Extract delta nodes. Structural only: section, axis, both values."""
    text = path.read_text()
    out, section = [], None
    for line in text.splitlines():
        if line.startswith("## "):
            section = line[3:].strip().lower()
        elif section and line.startswith("| ") and "|" in line[2:]:
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) != 4 or cells[0] in ("axis", "---"):
                continue
            axis, theirs, ours, delta = cells
            if delta == "ok" or set(delta) <= {"-"}:
                continue
            out.append(dict(kind="delta", id=f"{section}::{axis}",
                            section=section, axis=axis,
                            theirs=theirs, ours=ours, delta=delta,
                            source=str(path.relative_to(ROOT)),
                            viewport="1440x900", as_of=TODAY))
    return out


def build(deltas):
    nodes = {d["id"]: d for d in deltas}
    edges = []
    for c in CAUSES:
        nodes[c["id"]] = dict(kind="cause", id=c["id"], name=c["name"],
                              found=c["found"], as_of=TODAY)
        nodes[f"wave{c['wave']}"] = dict(kind="wave", id=f"wave{c['wave']}",
                                         name=f"Wave {c['wave']}")
        nodes[c["artifact"]] = dict(kind="artifact", id=c["artifact"])
        edges.append(dict(src=c["id"], rel="FIXED_IN", dst=f"wave{c['wave']}"))
        edges.append(dict(src=c["id"], rel="LIVES_IN", dst=c["artifact"]))
    for d in deltas:
        hit = [c for c in CAUSES if c["matches"](d["section"], d["axis"])]
        # Exactly one cause per delta, or it is unmodelled. Two causes claiming
        # the same delta means the ontology is wrong, not that the delta is
        # doubly caused, so it is reported rather than silently resolved.
        if len(hit) == 1:
            edges.append(dict(src=d["id"], rel="CAUSED_BY", dst=hit[0]["id"]))
        else:
            d["unmodelled"] = True
            d["claimed_by"] = [c["id"] for c in hit]
    return nodes, edges


def report(nodes, edges):
    fan = collections.Counter(e["dst"] for e in edges if e["rel"] == "CAUSED_BY")
    deltas = [n for n in nodes.values() if n["kind"] == "delta"]
    unmodelled = [d for d in deltas if d.get("unmodelled")]
    lines = [f"# The delta graph\n",
             f"Generated {TODAY} by `tools/deltagraph.py` from `docs/DELTAS.md`.",
             "",
             "A table answers *what differs*. This answers *what closes the most*,",
             "which is a multi-hop question and the only one worth asking before",
             "picking up the next piece of work.",
             "",
             f"    delta nodes      {len(deltas)}",
             f"    cause nodes      {len(CAUSES)}",
             f"    CAUSED_BY edges  {sum(fan.values())}",
             f"    unmodelled       {len(unmodelled)}",
             "",
             "## Causes by fan-out",
             "",
             "Fix the top one first. Wave 1 is the evidence this is worth doing:",
             "eight rows shared one cause, and a section-by-section reading would",
             "have chased eight symptoms instead.",
             "",
             "| cause | closes | wave | lives in |",
             "|---|---|---|---|"]
    for cid, n in fan.most_common():
        c = next(x for x in CAUSES if x["id"] == cid)
        if c.get("deliberate"):
            continue
        lines.append(f"| {c['name']} | **{n}** | {c['wave']} | `{c['artifact']}` |")
    dl = [c for c in CAUSES if c.get("deliberate")]
    if dl:
        lines += ["", "## Deliberate differences", "",
                  "Counted as deltas and not as work. Each closes rows that will",
                  "never reach zero, because ours is a decision rather than a gap.",
                  "", "| difference | rows | why |", "|---|---|---|"]
        for c in dl:
            lines.append(f"| {c['name']} | {fan.get(c['id'], 0)} | {c['found']} |")
    if unmodelled:
        lines += ["", "## Unmodelled deltas", "",
                  "No cause claims these, or more than one does. Either way the",
                  "ontology is incomplete and that is a finding, not a rounding",
                  "error.", "",
                  "| section | axis | delta | claimed by |", "|---|---|---|---|"]
        for d in unmodelled[:40]:
            lines.append(f"| {d['section']} | {d['axis']} | {d['delta']} | "
                         f"{', '.join(d.get('claimed_by') or ['none'])} |")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    deltas = parse(ROOT / "docs" / "DELTAS.md")
    nodes, edges = build(deltas)
    (ROOT / "docs" / "delta-graph.json").write_text(
        json.dumps(dict(nodes=list(nodes.values()), edges=edges), indent=1))
    out = report(nodes, edges)
    (ROOT / "docs" / "DELTA-GRAPH.md").write_text(out)
    print(out)
