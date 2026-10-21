"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import DancerCard from "@/components/dancer-card";
import type { DancerProfile, VerificationTier } from "@/types/database";
import { CREATIVE_DISCIPLINES } from "@/types/database";

const TIERS: { value: VerificationTier | "all"; label: string }[] = [
  { value: "all", label: "All Tiers" },
  { value: "2", label: "Tier 2: EGATS Verified" },
  { value: "1", label: "Tier 1: Verified Human" },
  { value: "0", label: "Tier 0: Camp Attendee" },
];

const AVAILABILITY_OPTIONS = [
  { value: "all", label: "Any Availability" },
  { value: "available", label: "Available Now" },
  { value: "limited", label: "Limited Availability" },
];

const EXPERIENCE_OPTIONS = [
  { value: "all", label: "Any Experience" },
  { value: "0-5", label: "0–5 years" },
  { value: "5-10", label: "5–10 years" },
  { value: "10+", label: "10+ years" },
];

export default function DancerSearchPage() {
  const [dancers, setDancers] = useState<DancerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [aiQuery, setAiQuery] = useState("");
  const [aiExplanation, setAiExplanation] = useState("");
  const [selectedTier, setSelectedTier] = useState<VerificationTier | "all">("all");
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [selectedAvailability, setSelectedAvailability] = useState("all");
  const [selectedExperience, setSelectedExperience] = useState("all");
  const [shortlist, setShortlist] = useState<string[]>([]);
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [shortlistName, setShortlistName] = useState("");
  const [savingShortlist, setSavingShortlist] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Fetch blocked user IDs on mount
  useEffect(() => {
    async function loadBlockedIds() {
      try {
        const res = await fetch("/api/privacy/block?format=exclude");
        if (res.ok) {
          const data = await res.json();
          setBlockedUserIds(new Set(data.excludeIds ?? []));
        }
      } catch { /* non-critical */ }
    }
    loadBlockedIds();
  }, []);

  const fetchDancers = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    const supabase = createClient();
    let query = supabase
      .from("dancer_profiles")
      .select("*, profile:profiles(display_name, avatar_url, location), clips:portfolio_clips(thumbnail_url, clip_url, styles, is_featured)")
      .order("verification_tier", { ascending: false })
      .order("total_bookings", { ascending: false });

    if (selectedTier !== "all") query = query.eq("verification_tier", selectedTier);
    if (selectedAvailability !== "all") query = query.eq("availability_status", selectedAvailability);
    if (selectedStyles.length > 0) query = query.overlaps("styles", selectedStyles);

    const { data, error } = await query.limit(48);
    if (error) {
      setFetchError("Failed to load creatives. Please try again.");
    } else {
      setDancers(data as DancerProfile[] || []);
    }
    setLoading(false);
  }, [selectedTier, selectedAvailability, selectedStyles]);

  useEffect(() => { fetchDancers(); }, [fetchDancers]);

  const filteredDancers = useMemo(() => {
    return dancers.filter((d) => {
      // Exclude blocked users (users I blocked or who blocked me)
      if (d.user_id && blockedUserIds.has(d.user_id)) return false;

      if (searchQuery) {
        const name = d.profile?.display_name?.toLowerCase() || "";
        const styles = d.styles.join(" ").toLowerCase();
        const stageName = (d.stage_name || "").toLowerCase();
        const q = searchQuery.toLowerCase();
        if (!name.includes(q) && !styles.includes(q) && !stageName.includes(q)) return false;
      }
      if (selectedExperience !== "all") {
        const yrs = d.experience_years ?? 0;
        if (selectedExperience === "0-5" && yrs >= 5) return false;
        if (selectedExperience === "5-10" && (yrs < 5 || yrs >= 10)) return false;
        if (selectedExperience === "10+" && yrs < 10) return false;
      }
      return true;
    });
  }, [dancers, searchQuery, selectedExperience, blockedUserIds]);

  async function handleAiSearch() {
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    setAiExplanation("");
    try {
      const res = await fetch("/api/ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: aiQuery }),
      });
      const data = await res.json();
      setAiExplanation(data.explanation);
      if (data.ids?.length) {
        setDancers((prev) => {
          const idSet = new Set(data.ids);
          return [...prev.filter((d) => idSet.has(d.id)), ...prev.filter((d) => !idSet.has(d.id))];
        });
      }
    } finally {
      setAiLoading(false);
    }
  }

  const toggleStyle = useCallback((style: string) => {
    setSelectedStyles((prev) =>
      prev.includes(style) ? prev.filter((s) => s !== style) : [...prev, style]
    );
    setPage(1);
  }, []);

  const addToShortlist = useCallback((id: string) => {
    setShortlist((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  }, []);

  async function handleSaveShortlist() {
    if (!shortlistName.trim()) return;
    setSavingShortlist(true);
    setSaveError("");
    try {
      const res = await fetch("/api/shortlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: shortlistName.trim(), dancerIds: shortlist }),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error || "Failed to save"); return; }
      setSaveSuccess(true);
      setTimeout(() => {
        setShowSaveModal(false);
        setShortlist([]);
        setShortlistName("");
        setSaveSuccess(false);
      }, 1500);
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSavingShortlist(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-1">Find Creatives</h1>
        <p className="text-white/40 text-sm">Search verified talent across every creative discipline. Build your shortlist.</p>
      </div>

      {/* AI Search */}
      <div className="bg-gradient-to-r from-violet-500/10 to-violet-600/5 border border-violet-500/20 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-violet-300">AI Intent Search</span>
        </div>
        <div className="flex gap-3">
          <input
            value={aiQuery}
            onChange={(e) => setAiQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAiSearch()}
            placeholder='e.g. "hip-hop dancers with tour experience in LA" or "models for runway in NYC"'
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50"
          />
          <button
            onClick={handleAiSearch}
            disabled={aiLoading}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            {aiLoading ? "Searching..." : "Search"}
          </button>
        </div>
        {aiExplanation && (
          <p className="text-xs text-violet-300/70 mt-3 italic">AI: {aiExplanation}</p>
        )}
      </div>

      {/* Text search + filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            placeholder="Search by name or style..."
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <select
          value={selectedTier}
          onChange={(e) => { setSelectedTier(e.target.value as VerificationTier | "all"); setPage(1); }}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
        >
          {TIERS.map((t) => <option key={t.value} value={t.value} className="bg-zinc-900">{t.label}</option>)}
        </select>
        <select
          value={selectedAvailability}
          onChange={(e) => { setSelectedAvailability(e.target.value); setPage(1); }}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
        >
          {AVAILABILITY_OPTIONS.map((a) => <option key={a.value} value={a.value} className="bg-zinc-900">{a.label}</option>)}
        </select>
        <select
          value={selectedExperience}
          onChange={(e) => { setSelectedExperience(e.target.value); setPage(1); }}
          className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
        >
          {EXPERIENCE_OPTIONS.map((e) => <option key={e.value} value={e.value} className="bg-zinc-900">{e.label}</option>)}
        </select>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${showFilters ? "bg-violet-500/20 border-violet-500/30 text-violet-300" : "bg-white/5 border-white/10 text-white/60 hover:text-white"}`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Styles {selectedStyles.length > 0 && `(${selectedStyles.length})`}
        </button>
      </div>

      {/* Style filters */}
      {showFilters && (
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
          <div className="flex flex-wrap gap-2">
            {CREATIVE_DISCIPLINES.map((style) => (
              <button
                key={style}
                onClick={() => toggleStyle(style)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                  selectedStyles.includes(style)
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

      {/* Shortlist bar */}
      {shortlist.length > 0 && (
        <>
          <div className="sticky top-4 z-30 flex items-center justify-between bg-violet-900/80 border border-violet-500/30 backdrop-blur-sm rounded-2xl px-6 py-4">
            <div className="text-sm font-semibold text-violet-200">
              {shortlist.length} creative{shortlist.length !== 1 ? "s" : ""} in shortlist
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { if (window.confirm("Clear all selected creatives?")) setShortlist([]); }}
                aria-label="Clear all selected dancers"
                className="text-xs text-violet-400 hover:text-violet-200 transition-colors flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Clear
              </button>
              <button
                onClick={() => setShowSaveModal(true)}
                className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors"
              >
                Save Shortlist
              </button>
            </div>
          </div>

          {showSaveModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4">
                <h3 className="font-bold text-lg">Save Shortlist</h3>
                <p className="text-white/50 text-sm">{shortlist.length} creative{shortlist.length !== 1 ? "s" : ""} selected</p>
                <input
                  value={shortlistName}
                  onChange={e => setShortlistName(e.target.value)}
                  placeholder="Shortlist name (e.g. Summer Tour Candidates)"
                  maxLength={100}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50"
                />
                {saveError && <p className="text-red-400 text-xs">{saveError}</p>}
                {saveSuccess && <p className="text-green-400 text-xs">Shortlist saved!</p>}
                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowSaveModal(false); setSaveError(""); setSaveSuccess(false); }}
                    className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                  >Cancel</button>
                  <button
                    onClick={handleSaveShortlist}
                    disabled={savingShortlist || !shortlistName.trim()}
                    className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                  >
                    {savingShortlist ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Results */}
      {fetchError && (
        <div className="text-center py-12">
          <p className="text-red-400 mb-4">{fetchError}</p>
          <button onClick={fetchDancers} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm transition-colors">
            Retry
          </button>
        </div>
      )}
      {!fetchError && loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="bg-white/[0.03] border border-white/5 rounded-2xl aspect-[3/4] animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {filteredDancers.length > 0 && (
            <p className="text-xs text-white/30">{filteredDancers.length} creative{filteredDancers.length !== 1 ? "s" : ""} found</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredDancers.map((dancer) => (
              <DancerCard
                key={dancer.id}
                dancer={dancer}
                onAddToShortlist={addToShortlist}
                inShortlist={shortlist.includes(dancer.id)}
              />
            ))}
            {filteredDancers.length === 0 && !loading && (
              <div className="col-span-full text-center py-20">
                <div className="text-5xl mb-4">🎭</div>
                <h3 className="text-lg font-semibold mb-2">No creatives found</h3>
                <p className="text-white/40 text-sm mb-6">Try different search terms or adjust your filters.</p>
                <button
                  onClick={() => { setSearchQuery(""); setSelectedExperience("all"); setSelectedStyles([]); setSelectedTier("all"); setSelectedAvailability("all"); }}
                  className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-semibold transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
