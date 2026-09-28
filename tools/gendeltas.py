import json, pathlib, datetime
ref=json.load(open("m2_REF.json")); ours=json.load(open("m2_OURS.json"))
R={s["i"]:s for s in ref["sections"]}; O={s["i"]:s for s in ours["sections"]}

PAIRS=[(0,0,"hero"),(None,1,"trace scene"),(1,2,"surface failures"),(2,6,"notifications"),
 (3,7,"fix where you work / MCP"),(4,5,"read the spans / ship with confidence"),
 (5,8,"fits into your stack"),(6,9,"trust"),(7,None,"testimonials"),
 (8,None,"subscribe"),(9,10,"friday briefing"),(10,11,"closing CTA"),
 (None,3,"failure wall  OURS ONLY"),(None,4,"counter  OURS ONLY")]

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

for ri,oi,role in PAIRS:
    r = R.get(ri) if ri is not None else None
    o = O.get(oi) if oi is not None else None
    out.append(f"\n## {role}\n")
    if r is None:
        out.append(f"No counterpart on theirs. Ours: `{o['heading']}`, y{o['y']}, {o['height']}px tall.\n")
        if "OURS ONLY" in role:
            out.append("Cut per the 2026-09-28 decision.\n")
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
