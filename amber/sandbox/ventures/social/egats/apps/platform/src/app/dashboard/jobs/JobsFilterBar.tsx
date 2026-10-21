"use client";
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { DANCE_STYLES, ROLE_TYPES } from "@/types/database";

export default function JobsFilterBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const currentType = searchParams.get("type") ?? "";
  const currentStyle = searchParams.get("style") ?? "";
  const currentSort = searchParams.get("sort") ?? "newest";
  const currentQ = searchParams.get("q") ?? "";

  const [searchInput, setSearchInput] = useState(currentQ);
  const [showStylePicker, setShowStylePicker] = useState(false);

  function buildUrl(overrides: Record<string, string>) {
    const p = new URLSearchParams();
    const merged = { type: currentType, style: currentStyle, sort: currentSort, q: currentQ, ...overrides };
    Object.entries(merged).forEach(([k, v]) => { if (v) p.set(k, v); });
    return `/dashboard/jobs?${p.toString()}`;
  }

  function navigate(overrides: Record<string, string>) {
    startTransition(() => router.push(buildUrl(overrides)));
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    navigate({ q: searchInput });
  }

  function clearAll() {
    setSearchInput("");
    startTransition(() => router.push("/dashboard/jobs"));
  }

  const hasActiveFilters = !!(currentType || currentStyle || currentQ || currentSort !== "newest");

  return (
    <div className="space-y-3">
      {/* Search + Sort row */}
      <div className="flex gap-3 flex-wrap">
        <form onSubmit={handleSearchSubmit} className="relative flex-1 min-w-48">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search jobs by title..."
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => { setSearchInput(""); navigate({ q: "" }); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </form>

        <select
          value={currentSort}
          onChange={(e) => navigate({ sort: e.target.value })}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
        >
          <option value="newest" className="bg-zinc-900">Newest first</option>
          <option value="pay_high" className="bg-zinc-900">Pay: high to low</option>
          <option value="deadline_soon" className="bg-zinc-900">Deadline: soonest</option>
        </select>

        <button
          onClick={() => setShowStylePicker((v) => !v)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
            currentStyle || showStylePicker
              ? "bg-violet-500/20 border-violet-500/30 text-violet-300"
              : "bg-white/5 border-white/10 text-white/60 hover:text-white"
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Style {currentStyle && `(${currentStyle})`}
        </button>

        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1.5 text-xs px-3 py-2.5 rounded-xl border border-white/10 text-white/30 hover:text-white/60 transition-colors"
          >
            <X className="w-3 h-3" /> Clear all
          </button>
        )}
      </div>

      {/* Role type pills */}
      <div className="flex gap-2 flex-wrap">
        {ROLE_TYPES.slice(0, 7).map((type) => (
          <button
            key={type}
            onClick={() => navigate({ type: currentType === type ? "" : type })}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
              currentType === type
                ? "bg-violet-600 border-violet-500 text-white"
                : "bg-white/5 border-white/10 text-white/50 hover:text-white"
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Style picker */}
      {showStylePicker && (
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
          <div className="flex flex-wrap gap-2">
            {DANCE_STYLES.map((style) => (
              <button
                key={style}
                onClick={() => navigate({ style: currentStyle === style ? "" : style })}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                  currentStyle === style
                    ? "bg-violet-600 border-violet-500 text-white"
                    : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:border-white/20"
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
