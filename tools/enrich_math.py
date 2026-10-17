"""The arithmetic behind picking a Clay enrichment: counted outcomes in, a decision or a test out.

Caleb, 2026-10-17: "Nothing in this process should be based on vibes/rough association! There
needs to be substantial factors all taken mathematically into account for a robust process".
The first version of enrich_catalog used hand-set hit rates (0.5 single, 0.75 waterfall) and a
guessed 5-credit value per contact, and its pick came down to 2.65 vs 2.62, a coin flip dressed
as a decision. This module replaces both:

- Every rate is a Beta posterior over counted outcomes, starting from Beta(1, 1): no opinion
  before data. An option nobody has run has a wide interval, not a made-up number.
- A result counts only when it is usable: found, verified valid, and at the brand or the parent
  the chain actually searched. "Found" alone counted a valid inbox at a company the person left.
- A cascade (cheap option first, the other only on its misses) is priced as its own option:
  cost = c1 + (1 - p1) * c2 and yield = p1 + (1 - p1) * p2|miss.
- Value per contact comes from the client's own numbers (deal size, reply and close rates, dollars
  per credit). Missing any one, the metric is credits per usable contact, and the value-based
  net is reported as unknown rather than filled in.
- The options are compared by sampling every posterior together, so the output is the probability
  each option is actually best. Under CONFIDENT the answer is a test with a row count, not a pick.
"""
import math
import random

PRIOR_A = PRIOR_B = 1.0
# 20,000 joint draws: the standard error of a P(best) near 0.5 is sqrt(0.25 / 20000) = 0.0035,
# well under the 0.1 gaps the decision turns on.
DRAWS = 20000
SEED = 17
# Pick outright only when the leader is best in at least 90% of draws. Caleb hasn't stated a
# tolerance for a wrong pick; 1 in 10 is a guess, never measured. Raise it if a wrong pick costs more.
CONFIDENT = 0.9
# A test is sized so the tested rate's 90% interval is within +/- 0.10 (normal approximation).
Z90 = 1.645
TEST_HALF_WIDTH = 0.10


def posterior(usable, tried):
    return PRIOR_A + usable, PRIOR_B + max(tried - usable, 0)


def client_value(v):
    """Credits one usable contact is worth, or None when any factor is missing."""
    keys = ("deal_usd", "reply_rate", "close_rate", "usd_per_credit")
    if not v or any(v.get(k) in (None, 0) for k in keys):
        return None
    return v["deal_usd"] * v["reply_rate"] * v["close_rate"] / v["usd_per_credit"]


def rows_to_test(mean, tried):
    need = math.ceil(Z90 ** 2 * mean * (1 - mean) / TEST_HALF_WIDTH ** 2)
    return int(max(need - tried, 0))


def compare(options, value=None, seed=SEED, n=DRAWS):
    """options: [{name, credits, rates: [(a, b), ...], cascade: bool}] where a cascade has two rates
    (first option, second option on the first one's misses) and two credits.

    Returns the options with yield/cost stats and p_best, sorted best first, plus a decision.
    """
    rng = random.Random(seed)
    priced = [o for o in options if o.get("credits") is not None]
    wins = [0] * len(priced)
    metric_draws = [[] for _ in priced]
    yield_draws = [[] for _ in priced]
    for _ in range(n):
        best, best_score = None, None
        for i, o in enumerate(priced):
            ps = [rng.betavariate(a, b) for a, b in o["rates"]]
            if o.get("cascade"):
                p = ps[0] + (1 - ps[0]) * ps[1]
                c = o["credits"][0] + (1 - ps[0]) * o["credits"][1]
            else:
                p, c = ps[0], o["credits"]
            # Higher is better in both modes: net credits, or usable contacts per credit.
            score = value * p - c if value is not None else (p / c if c else float("inf"))
            yield_draws[i].append(p)
            metric_draws[i].append(score)
            if best_score is None or score > best_score:
                best, best_score = i, score
        wins[best] += 1
    out = []
    for i, o in enumerate(priced):
        ys, ms = sorted(yield_draws[i]), sorted(metric_draws[i])
        cost = o["credits"] if not o.get("cascade") else None
        out.append({**o, "p_best": wins[i] / n, "yield": {"mean": sum(ys) / n, "lo": ys[int(0.05 * n)],
                                                           "hi": ys[int(0.95 * n) - 1]},
                    "metric_mean": sum(ms) / n, "metric": "net credits per row" if value is not None
                    else "usable contacts per credit", "cost": cost})
    out.sort(key=lambda r: -r["p_best"])
    out += [{**o, "p_best": None, "metric": "price unknown"} for o in options if o.get("credits") is None]
    return out, decide(out)


def decide(ranked):
    if not ranked or ranked[0].get("p_best") is None:
        return {"action": "none", "why": "no priced option"}
    lead = ranked[0]
    if lead["p_best"] >= CONFIDENT:
        return {"action": "pick", "name": lead["name"], "p_best": lead["p_best"]}
    # Test whichever of the top two has the wider 90% yield interval: that uncertainty is what's
    # holding the call. Within it, the least-counted step is the one to run.
    top = [r for r in ranked[:2] if r.get("p_best") is not None]
    target = max(top, key=lambda r: r["yield"]["hi"] - r["yield"]["lo"])
    a, b = min(target["rates"], key=lambda ab: ab[0] + ab[1])
    n = rows_to_test(a / (a + b), a + b - PRIOR_A - PRIOR_B)
    what = target["name"] + (" (second step on the first step's misses)" if target.get("cascade") else "")
    return {"action": "test", "name": what, "rows": n, "p_best": lead["p_best"], "leader": lead["name"]}
