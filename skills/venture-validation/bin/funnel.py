#!/usr/bin/env python3
"""Read a paid validation test the way ACAD 185 grades it.

Give it the raw totals from an ad test (spend, impressions or CPM, clicks,
leads, reservations) and the product's price and COGS. It prints every funnel
metric, which stage misses its benchmark, the three eROAS scenarios, profit
per unit, a verdict, and the one change that would clear the bar with every
other stage held where it is.

    funnel.py --spend 2000 --impressions 89898 --clicks 6176 --leads 1791 \
              --reservations 161 --price 97 --cogs 24.25
    funnel.py --json test.json          # same keys as the flags
    funnel.py ... --bar 2.0 --format json
"""
import argparse
import json
import sys

# Course numbers, from the W4S8 deck and the A10 template (Swain, Fall 2026).
# 30% of reservations and 1% of leads end up buying in the realistic case;
# the deck brackets them at 20%/0.5% and 40%/2%.
SCENARIOS = {"pessimistic": (0.20, 0.005), "realistic": (0.30, 0.01), "optimistic": (0.40, 0.02)}
# Stage floors from the A10 template: CTR > 3%, L-CR > 20%, R-CR > 5%.
FLOORS = {"ctr": 0.03, "lcr": 0.20, "rcr": 0.05}
# The A10 template says "A 300% or higher realistic eROAS is a pass". An
# earlier version of the same template said 200%, which is what Caleb's 40/40
# dashboard used; the verdicts in that set were the same under both.
BAR = 3.0
LEVERS = {
    "ctr": "CPM and CTR: audience, placement, quality of the ad creative",
    "lcr": "L-CR: audience, ad congruity, landing page creative, product details",
    "rcr": "R-CR: price, discount, conversion design",
}


def metrics(t):
    spend, clicks, leads, res = t["spend"], t["clicks"], t["leads"], t["reservations"]
    imp = t.get("impressions") or (spend / t["cpm"] * 1000)
    m = {
        "impressions": imp,
        "cpm": spend / imp * 1000,
        "ctr": clicks / imp,
        "lcr": leads / clicks if clicks else 0.0,
        "rcr": res / leads if leads else 0.0,
        "cpl": spend / leads if leads else float("inf"),
        "cpr": spend / res if res else float("inf"),
    }
    for name, (rp, lp) in SCENARIOS.items():
        m["eroas_" + name] = t["price"] * (res * rp + leads * lp) / spend
    m["cac"] = m["cpr"] / SCENARIOS["realistic"][0]
    m["profit_per_unit"] = t["price"] - t.get("cogs", 0.0) - m["cac"]
    cogs_share = t.get("cogs", 0.0) / t["price"] if t["price"] else 0.0
    m["break_even_eroas"] = 1 / (1 - cogs_share) if cogs_share < 1 else float("inf")
    return m


def eroas_with(t, m, **over):
    """Realistic eROAS with one rate changed and every other stage held."""
    ctr, lcr, rcr = over.get("ctr", m["ctr"]), over.get("lcr", m["lcr"]), over.get("rcr", m["rcr"])
    price = over.get("price", t["price"])
    leads = m["impressions"] * ctr * lcr
    res = leads * rcr
    rp, lp = SCENARIOS["realistic"]
    return price * (res * rp + leads * lp) / t["spend"]


def solve(t, m, lever, bar):
    """Smallest value of one lever that reaches the bar, or None."""
    lo, hi = (0.0, 1.0) if lever != "price" else (0.0, 1e7)
    if eroas_with(t, m, **{lever: hi}) < bar:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        if eroas_with(t, m, **{lever: mid}) >= bar:
            hi = mid
        else:
            lo = mid
    return hi


def report(t, bar):
    m = metrics(t)
    misses = [k for k in ("ctr", "lcr", "rcr") if m[k] <= FLOORS[k]]
    real = m["eroas_realistic"]
    passed = real >= bar and m["profit_per_unit"] > 0
    out = {"metrics": m, "bar": bar, "misses": misses, "pass": passed, "levers": {}}
    for lever in ("ctr", "lcr", "rcr", "price"):
        out["levers"][lever] = {"now": m.get(lever, t["price"]), "needed": solve(t, m, lever, bar)}
    if passed:
        out["verdict"] = "PASS: spend on marketing"
    elif not misses:
        out["verdict"] = "FAIL with every stage at benchmark: the problem is price, not the funnel"
    else:
        out["verdict"] = "FAIL: fix " + misses[0].upper() + " first (" + LEVERS[misses[0]] + "), then retest or pivot"
    if passed and t["reservations"] < 50:
        out["warning"] = f"only {t['reservations']} reservations: run a bigger test before scaling"
    return out


def pct(x):
    return f"{x:.2%}"


def text(r):
    m = r["metrics"]
    lines = [
        f"Impressions {m['impressions']:,.0f}   CPM ${m['cpm']:.2f}",
        f"CTR   {pct(m['ctr']):>8}  floor >3%   {'MISS' if 'ctr' in r['misses'] else 'ok'}",
        f"L-CR  {pct(m['lcr']):>8}  floor >20%  {'MISS' if 'lcr' in r['misses'] else 'ok'}",
        f"R-CR  {pct(m['rcr']):>8}  floor >5%   {'MISS' if 'rcr' in r['misses'] else 'ok'}",
        f"CPL ${m['cpl']:.2f}   CPR ${m['cpr']:.2f}   CAC ${m['cac']:.2f}",
        f"eROAS pessimistic {pct(m['eroas_pessimistic'])}   realistic {pct(m['eroas_realistic'])}   optimistic {pct(m['eroas_optimistic'])}",
        f"Bar {pct(r['bar'])}   break-even {pct(m['break_even_eroas'])}   profit per unit ${m['profit_per_unit']:.2f}",
        r["verdict"],
    ]
    if r.get("warning"):
        lines.append("Warning: " + r["warning"])
    if not r["pass"]:
        lines.append("One change that clears the bar, everything else held:")
        for k, v in r["levers"].items():
            if v["needed"] is None:
                lines.append(f"- {k.upper()}: no value of this alone clears it")
            elif k == "price":
                lines.append(f"- PRICE ${v['now']:,.2f} -> ${v['needed']:,.2f}")
            else:
                lines.append(f"- {k.upper()} {pct(v['now'])} -> {pct(v['needed'])}")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json")
    for k in ("spend", "impressions", "cpm", "clicks", "leads", "reservations", "price", "cogs"):
        ap.add_argument("--" + k, type=float)
    ap.add_argument("--bar", type=float, default=BAR, help="realistic eROAS pass bar as a ratio, 3.0 = 300%%")
    ap.add_argument("--format", choices=("text", "json"), default="text")
    a = ap.parse_args(argv)
    t = json.load(open(a.json)) if a.json else {}
    for k in ("spend", "impressions", "cpm", "clicks", "leads", "reservations", "price", "cogs"):
        if getattr(a, k) is not None:
            t[k] = getattr(a, k)
    need = [k for k in ("spend", "clicks", "leads", "reservations", "price") if k not in t]
    if not t.get("impressions") and not t.get("cpm"):
        need.append("impressions or cpm")
    if need:
        sys.exit("funnel.py: missing " + ", ".join(need))
    r = report(t, a.bar)
    print(json.dumps(r, indent=1, default=str) if a.format == "json" else text(r))


if __name__ == "__main__":
    main()
