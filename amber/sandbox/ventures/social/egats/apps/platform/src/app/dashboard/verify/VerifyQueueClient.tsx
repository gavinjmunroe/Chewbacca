"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { TIER_LABELS } from "@/types/database";
import type { VerificationTier } from "@/types/database";

interface PendingRecord {
  id: string;
  dancer_id: string;
  camp_id: string | null;
  requested_tier: VerificationTier;
  status: string;
  created_at: string;
  dancer: {
    id: string;
    verification_tier: VerificationTier;
    profile: {
      display_name: string;
      avatar_url: string | null;
    } | null;
  } | null;
  camp?: {
    name: string;
  } | null;
}

type TierFilter = "all" | "1" | "2";
type SortOption = "oldest" | "newest" | "tier1first" | "tier2first";

interface Props {
  records: PendingRecord[];
}

export default function VerifyQueueClient({ records }: Props) {
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [sortOption, setSortOption] = useState<SortOption>("oldest");
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const tier1Count = records.filter((r) => r.requested_tier === "1").length;
  const tier2Count = records.filter((r) => r.requested_tier === "2").length;

  const filteredRecords = useMemo(() => {
    let list = records.filter((r) => !approvedIds.has(r.id));

    // Tier filter
    if (tierFilter !== "all") {
      list = list.filter((r) => r.requested_tier === tierFilter);
    }

    // Sort
    switch (sortOption) {
      case "newest":
        list = [...list].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        break;
      case "tier1first":
        list = [...list].sort((a, b) => {
          if (a.requested_tier === "1" && b.requested_tier !== "1") return -1;
          if (a.requested_tier !== "1" && b.requested_tier === "1") return 1;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
        break;
      case "tier2first":
        list = [...list].sort((a, b) => {
          if (a.requested_tier === "2" && b.requested_tier !== "2") return -1;
          if (a.requested_tier !== "2" && b.requested_tier === "2") return 1;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
        break;
      case "oldest":
      default:
        list = [...list].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        break;
    }

    return list;
  }, [records, tierFilter, sortOption, approvedIds]);

  const pendingTier1 = records.filter(
    (r) => r.requested_tier === "1" && !approvedIds.has(r.id)
  );

  async function handleBatchApprove() {
    const count = pendingTier1.length;
    if (count === 0) return;

    const confirmed = window.confirm(
      `Approve ${count} pending Tier 1 application${count !== 1 ? "s" : ""}? This verifies identity only.`
    );
    if (!confirmed) return;

    setBatchError(null);
    setBatchProgress({ current: 0, total: count });

    const newlyApproved = new Set<string>();

    for (let i = 0; i < pendingTier1.length; i++) {
      const record = pendingTier1[i];
      setBatchProgress({ current: i + 1, total: count });

      try {
        const res = await fetch(`/api/verification-records/${record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "approved" }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }

        newlyApproved.add(record.id);
      } catch (err) {
        setBatchError(`Failed on record ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
        setBatchProgress(null);
        setApprovedIds((prev) => new Set([...prev, ...newlyApproved]));
        return;
      }
    }

    startTransition(() => {
      setApprovedIds((prev) => new Set([...prev, ...newlyApproved]));
    });
    setBatchProgress(null);
  }

  const tabCounts = {
    all: records.filter((r) => !approvedIds.has(r.id)).length,
    "1": records.filter((r) => r.requested_tier === "1" && !approvedIds.has(r.id)).length,
    "2": records.filter((r) => r.requested_tier === "2" && !approvedIds.has(r.id)).length,
  };

  return (
    <>
      {/* Filters + Sort row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        {/* Tier filter tabs */}
        <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.08] rounded-xl p-1">
          {(["all", "1", "2"] as const).map((tab) => {
            const label = tab === "all" ? "All" : `Tier ${tab}`;
            const count = tabCounts[tab];
            const active = tierFilter === tab;
            return (
              <button
                key={tab}
                onClick={() => setTierFilter(tab)}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-all ${
                  active
                    ? "bg-violet-500 text-white shadow-sm"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {label}
                <span
                  className={`ml-1.5 text-[11px] font-bold ${
                    active ? "text-violet-200" : "text-white/30"
                  }`}
                >
                  ({count})
                </span>
              </button>
            );
          })}
        </div>

        {/* Sort select */}
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-white/30 font-medium">Sort:</span>
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as SortOption)}
            className="bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-1.5 text-[13px] text-white/70 focus:outline-none focus:border-violet-500/50 cursor-pointer"
          >
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
            <option value="tier1first">Tier 1 first</option>
            <option value="tier2first">Tier 2 first</option>
          </select>
        </div>
      </div>

      {/* Batch approve button */}
      {pendingTier1.length > 0 && !batchProgress && (
        <div className="mb-6">
          <button
            onClick={handleBatchApprove}
            disabled={isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/10 hover:bg-green-500/20 border border-green-500/25 hover:border-green-500/40 rounded-xl text-[13px] font-semibold text-green-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            Approve All Tier 1 ({pendingTier1.length})
          </button>
        </div>
      )}

      {/* Batch progress */}
      {batchProgress && (
        <div className="mb-6 bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-3">
          <p className="text-violet-300 text-sm font-medium">
            Approving {batchProgress.current} of {batchProgress.total}…
          </p>
          <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-500 rounded-full transition-all"
              style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Batch error */}
      {batchError && (
        <div className="mb-6 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          <p className="text-red-400 text-sm">{batchError}</p>
        </div>
      )}

      {/* Empty filtered state */}
      {filteredRecords.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-5">
            <svg
              className="w-8 h-8 text-violet-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white/80 mb-2">
            {tierFilter !== "all"
              ? `No pending Tier ${tierFilter} requests`
              : "Queue is clear"}
          </h2>
          <p className="text-white/40 text-sm max-w-xs">
            {tierFilter !== "all"
              ? "Try switching to a different tier filter."
              : "There are no pending verification requests right now. Check back later."}
          </p>
        </div>
      )}

      {/* Records list */}
      {filteredRecords.length > 0 && (
        <div className="grid gap-3">
          {filteredRecords.map((record) => {
            const dancer = record.dancer;
            const dancerProfile = dancer?.profile;
            const displayName = dancerProfile?.display_name ?? "Unknown Dancer";
            const avatarUrl = dancerProfile?.avatar_url ?? null;
            const currentTier = dancer?.verification_tier ?? "0";
            const requestedTier = record.requested_tier;
            const campName = record.camp?.name ?? null;
            const submittedAt = new Date(record.created_at);

            return (
              <div
                key={record.id}
                className="bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.14] rounded-2xl p-5 flex items-center gap-5 transition-colors"
              >
                {/* Avatar */}
                <div className="shrink-0 w-12 h-12 rounded-full bg-white/[0.07] border border-white/[0.08] overflow-hidden flex items-center justify-center text-white/40 text-sm font-semibold">
                  {avatarUrl ? (
                    <Image
                      src={avatarUrl}
                      alt={displayName}
                      width={48}
                      height={48}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    displayName.slice(0, 2).toUpperCase()
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-white/90 truncate">{displayName}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                    <span className="text-[12px] text-white/40">
                      Requesting{" "}
                      <span className="text-violet-400 font-medium">
                        Tier {requestedTier}: {TIER_LABELS[requestedTier as VerificationTier]}
                      </span>
                    </span>
                    <span className="text-white/20 text-[11px]">·</span>
                    <span className="text-[12px] text-white/30">
                      Current: Tier {currentTier}
                    </span>
                    {campName && (
                      <>
                        <span className="text-white/20 text-[11px]">·</span>
                        <span className="text-[12px] text-white/40">
                          Camp:{" "}
                          <span className="text-white/60">{campName}</span>
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-white/25 mt-1">
                    Submitted{" "}
                    {submittedAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>

                {/* Review button */}
                <Link
                  href={`/dashboard/verify/${record.id}`}
                  className="shrink-0 px-4 py-2 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 hover:border-violet-500/50 rounded-xl text-[13px] font-semibold text-violet-300 transition-all"
                >
                  Review
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
