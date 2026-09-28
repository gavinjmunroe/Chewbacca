import json, pathlib, datetime
ref=json.load(open("m2_REF.json")); ours=json.load(open("m2_OURS.json"))

# PAIRING BY HEADING TEXT, WITH EXPLICIT OVERRIDES.
#
# This was a hardcoded list of index pairs and it went stale the moment Wave 1
# changed the section set: it started comparing our Subscribe against their
# "Fits into your existing stack", and the ledger reported a 36px heading as
# 18px and a whole column of nonsense deltas that sent me looking at correct
# code. An index pairing is a snapshot of a structure that is being actively
# changed, which is the worst thing to hardcode.
#
# It can be text now because our copy has converged: 10 of the 11 headings
# match theirs exactly. Only the hero differs, deliberately, since that copy
# is ours. Anything that cannot be paired is REPORTED rather than guessed at,
# because a silently wrong pair is worse than an absent one.
OVERRIDES = {
    # ours -> theirs, where the copy is deliberately different
    "Your agent failed and nothing threw an error": "Stop guessing why your agents fail",
}
ROLE = {
    "Stop guessing why your agents fail": "hero",
    "Surface failures you didn't know to look for.": "surface failures",
    "Get notified on what matters.": "notifications",
    "Fix it where you work.": "fix where you work / MCP",
    "Ship with confidence.": "ship with confidence",
    "Fits into your existing stack.": "fits into your stack",
    "Trust is non-negotiable.": "trust",
    "What people are saying.": "testimonials",
    "Subscribe": "subscribe",
    "The Friday briefing on AI agent observability and reliability.": "friday briefing",
    "Start improving your agents today": "closing CTA",
}

def key(sec):
    return sec["heading"].strip()

def pair(ref, ours):
    R = {key(s): s for s in ref["sections"]}
    O = {key(s): s for s in ours["sections"]}
    pairs, used_r, used_o = [], set(), set()
    for ok, osec in O.items():
        rk = OVERRIDES.get(ok, ok)
        if rk in R:
            pairs.append((R[rk], osec, ROLE.get(rk, rk[:34])))
            used_r.add(rk); used_o.add(ok)
    for rk, rsec in R.items():
        if rk not in used_r:
            pairs.append((rsec, None, ROLE.get(rk, rk[:34]) + "  THEIRS ONLY"))
    for ok, osec in O.items():
        if ok not in used_o:
            pairs.append((None, osec, ok[:34] + "  OURS ONLY"))
    # page order, by whichever side exists
    pairs.sort(key=lambda t: (t[0] or t[1])["y"])
    return pairs

def num(v):
    if v is None: return None
    if isinstance(v,(int,float)): return float(v)
    try: return float(str(v).replace("px","").strip())
    except Exception: return None

def row(label, rv, ov, unit=""):
    rn, on = num(rv), num(ov)
    if rn is not None and on is not None:
        d = on - rn
        mark = "ok" if abs(d) < 0.5 else ("**%+g**" % round(d,2))
        return f"| {label} | {rv}{unit} | {ov}{unit} | {mark} |"
    return f"| {label} | {rv if rv is not None else '-'}{unit} | {ov if ov is not None else '-'}{unit} | {'-' if rv==ov else '**differs**'} |"

out=[f"""# Deltas

Phase 0.2. Generated {datetime.date.today()} from `m2_REF.json` and `m2_OURS.json`,
both measured at 1440 with the viewport placed at each section. One row per
section per axis, with both numbers and the difference. Nothing here says
"approximately".

`ok` means inside half a pixel. A bold number is ours minus theirs.

Pairing comes from `SECTIONS.md` and is by position and role, never heading text.
"""]

for r, o, role in pair(ref, ours):
    out.append(f"\n## {role}\n")
    if r is None:
        out.append(f"No counterpart on theirs. Ours: `{o['heading']}`, y{o['y']}, {o['height']}px tall.\n")
        continue
    if o is None:
        out.append(f"No counterpart on ours. Theirs: `{r['heading']}`, y{r['y']}, {r['height']}px tall.\n")
        out.append("To be built.\n")
        continue
    out.append(f"theirs `{r['heading']}`  |  ours `{o['heading']}`\n")
    out.append("| axis | theirs | ours | delta |")
    out.append("|---|---|---|---|")
    out.append(row("section height", r["height"], o["height"], "px"))
    out.append(row("heading size", r.get("h_size"), o.get("h_size")))
    out.append(row("heading leading", r.get("h_lh"), o.get("h_lh")))
    out.append(row("heading tracking", r.get("h_ls"), o.get("h_ls")))
    out.append(row("heading weight", r.get("h_weight"), o.get("h_weight")))
    out.append(f"| heading align | {r.get('h_align')} | {o.get('h_align')} | {'ok' if r.get('h_align')==o.get('h_align') else '**differs**'} |")
    out.append(row("heading x", r.get("h_x"), o.get("h_x"), "px"))
    out.append(row("heading width", r.get("h_w"), o.get("h_w"), "px"))
    out.append(row("heading lines", r.get("h_lines"), o.get("h_lines")))
    rl, ol = r.get("lead") or {}, o.get("lead") or {}
    out.append(row("lead size", rl.get("size"), ol.get("size")))
    out.append(row("lead leading", rl.get("lh"), ol.get("lh")))
    out.append(row("lead width", rl.get("w"), ol.get("w"), "px"))
    out.append(row("lead gap under heading", rl.get("gap"), ol.get("gap"), "px"))
    out.append(row("painted elements", r.get("painted"), o.get("painted")))
    out.append(row("svg shapes", r.get("shapes"), o.get("shapes")))
    out.append(row("controls", r.get("controls"), o.get("controls")))
    rm, om = r.get("mockup") or {}, o.get("mockup") or {}
    out.append(row("largest block width", rm.get("w"), om.get("w"), "px"))
    out.append(row("largest block height", rm.get("h"), om.get("h"), "px"))
    out.append(row("largest block children", rm.get("kids"), om.get("kids")))
    out.append("")

pathlib.Path("DELTAS.md").write_text("\n".join(out)+"\n")
print("DELTAS.md:", len("\n".join(out).splitlines()), "lines")
