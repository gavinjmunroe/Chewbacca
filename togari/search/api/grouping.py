"""UC3 leader-anchored group assignment.

Given:
  - leader_ids:    Blind-8-picked leaders, length == group_count
  - all_ids:       full roster (includes leaders)
  - pair_scores:   dict[(a, b)] -> compatibility score in [0, 1] (symmetric)
  - group_size:    members per group, INCLUDING leader (informational)

Returns:
  groups: list[list[member_id]] of length group_count
          each group's first entry is its leader
          all leaders present, no leader appears twice
          every non-leader in all_ids appears in exactly one group
          group sizes balanced: floor(N/G) or ceil(N/G)

Algorithm:
  1. Greedy seed: rank non-leaders by best leader-affinity, place strongest first
  2. Local-swap optimization: up to 20 passes, swap any (m1, m2) across groups
     iff total intra-group compatibility strictly improves
"""
from __future__ import annotations

from itertools import combinations
from typing import Dict, List, Tuple


def _group_score(members: List[str], pair_scores: Dict[Tuple[str, str], float]) -> float:
    total = 0.0
    for a, b in combinations(members, 2):
        key = (a, b) if (a, b) in pair_scores else (b, a)
        total += pair_scores.get(key, 0.0)
    return total


def _capacities(group_count: int, attendee_count: int) -> List[int]:
    base = attendee_count // group_count
    extra = attendee_count - base * group_count
    return [base + 1 if i < extra else base for i in range(group_count)]


def assign_groups(
    leader_ids: List[str],
    all_ids: List[str],
    pair_scores: Dict[Tuple[str, str], float],
    group_size: int = None,  # noqa: ARG001 - informational
) -> List[List[str]]:
    group_count = len(leader_ids)
    if group_count == 0:
        return []

    leader_set = set(leader_ids)
    if not leader_set.issubset(set(all_ids)):
        missing = leader_set - set(all_ids)
        raise ValueError(f"leader_ids not in attendees: {missing}")

    non_leaders = [a for a in all_ids if a not in leader_set]
    capacities = _capacities(group_count, len(all_ids))
    leader_index = {lid: i for i, lid in enumerate(leader_ids)}

    groups: List[List[str]] = [[lid] for lid in leader_ids]

    def score_to_leader(member_id: str, leader_id: str) -> float:
        key = (member_id, leader_id) if (member_id, leader_id) in pair_scores else (leader_id, member_id)
        return pair_scores.get(key, 0.0)

    def best_leader_score(m: str) -> float:
        return max((score_to_leader(m, lid) for lid in leader_ids), default=0.0)

    placement_order = sorted(non_leaders, key=best_leader_score, reverse=True)

    for member_id in placement_order:
        ranked = sorted(
            leader_ids,
            key=lambda lid: score_to_leader(member_id, lid),
            reverse=True,
        )
        placed = False
        for lid in ranked:
            idx = leader_index[lid]
            if len(groups[idx]) < capacities[idx]:
                groups[idx].append(member_id)
                placed = True
                break
        if not placed:
            idx = min(range(group_count), key=lambda i: len(groups[i]))
            groups[idx].append(member_id)

    # Local-swap optimization. Leader at index 0 of each group is fixed.
    for _ in range(20):
        improved = False
        for gi in range(group_count):
            for gj in range(gi + 1, group_count):
                for i_idx in range(1, len(groups[gi])):
                    for j_idx in range(1, len(groups[gj])):
                        m1 = groups[gi][i_idx]
                        m2 = groups[gj][j_idx]
                        before = _group_score(groups[gi], pair_scores) + _group_score(groups[gj], pair_scores)
                        groups[gi][i_idx] = m2
                        groups[gj][j_idx] = m1
                        after = _group_score(groups[gi], pair_scores) + _group_score(groups[gj], pair_scores)
                        if after > before + 1e-9:
                            improved = True
                        else:
                            groups[gi][i_idx] = m1
                            groups[gj][j_idx] = m2
        if not improved:
            break

    return groups
