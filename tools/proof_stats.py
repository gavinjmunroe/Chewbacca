#!/usr/bin/env python3
"""The proof layer's statistics: one place every bench takes its intervals from.

    wilson(k, n)            95% Wilson score interval for k successes in n
    mcnemar_exact(b, c)     two-sided exact McNemar p-value on the discordant pairs
    median_ci(xs)           the median and a distribution-free 95% interval from
                            order statistics (needs n >= 6 for any interval)

MOG-PLAN.md section 3 decided these before the data: Wilson for rates, exact
McNemar for two versions of our own on the same items, medians for latency.
Stdlib only, runs on /usr/bin/python3 3.9.
"""
from __future__ import annotations

import math
from typing import List, Optional, Sequence, Tuple

# 95% two-sided normal quantile.
Z95 = 1.959963984540054


def wilson(k: int, n: int, z: float = Z95) -> Tuple[float, float]:
    if n <= 0 or k < 0 or k > n:
        raise ValueError("need 0 <= k <= n and n > 0")
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def _binom_cdf(k: int, n: int) -> float:
    """P(X <= k) for X ~ Binomial(n, 1/2)."""
    return sum(math.comb(n, i) for i in range(0, k + 1)) / (2 ** n)


def mcnemar_exact(b: int, c: int) -> float:
    """b: pairs only the first version got right; c: only the second."""
    n = b + c
    if n == 0:
        return 1.0
    return min(1.0, 2 * _binom_cdf(min(b, c), n))


def median(xs: Sequence[float]) -> float:
    s = sorted(xs)
    if not s:
        raise ValueError("no values")
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def median_ci(xs: Sequence[float], level: float = 0.95) -> Tuple[float, Optional[float], Optional[float]]:
    """The median and the widest-needed order-statistic interval that covers it
    with at least `level` confidence. Below n = 6 no pair reaches 95%, so the
    bounds are None: one stopwatch run is a number, not a result."""
    s: List[float] = sorted(xs)
    n = len(s)
    med = median(s)
    # Largest j (1-based) with P(X < j) <= (1 - level)/2, X ~ Bin(n, 1/2).
    alpha = (1 - level) / 2
    j = 0
    while j + 1 <= n and _binom_cdf(j, n) <= alpha:
        j += 1
    if j == 0:
        return med, None, None
    return med, s[j - 1], s[n - j]
