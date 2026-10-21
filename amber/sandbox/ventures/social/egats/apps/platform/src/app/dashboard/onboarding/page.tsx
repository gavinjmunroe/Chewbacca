"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CREATIVE_DISCIPLINES } from "@/types/database";

export default function OnboardingPage() {
  const router = useRouter();
  const [role, setRole] = useState<"dancer" | "creative" | "recruiter" | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shared
  const [displayName, setDisplayName] = useState("");
  const [location, setLocation] = useState("");

  // Dancer-specific
  const [experienceYears, setExperienceYears] = useState<number | "">(0);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);

  // Recruiter-specific
  const [companyName, setCompanyName] = useState("");

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, display_name")
        .eq("id", user.id)
        .single();

      if (profile) {
        setRole(profile.role as "dancer" | "creative" | "recruiter");
        if (profile.display_name) setDisplayName(profile.display_name);
      }
      setLoading(false);
    }
    loadProfile();
  }, [router]);

  function toggleStyle(style: string) {
    setSelectedStyles((prev) =>
      prev.includes(style) ? prev.filter((s) => s !== style) : [...prev, style]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!displayName.trim()) {
      setError("Please enter your display name.");
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        displayName: displayName.trim(),
        location: location.trim() || null,
      };

      if (role === "dancer" || role === "creative") {
        body.experienceYears = typeof experienceYears === "number" ? experienceYears : 0;
        body.styles = selectedStyles;
      } else if (role === "recruiter") {
        body.companyName = companyName.trim() || null;
      }

      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save profile.");
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-10 px-4">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Welcome to EGATS! Let&apos;s set up your profile.
        </h1>
        <p className="text-sm text-white/40 mt-2">
          Fill in a few details so{" "}
          {role === "recruiter" ? "creatives know who you are" : "recruiters can find you"}.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6 space-y-5">

          {/* Display Name */}
          <div>
            <label htmlFor="ob-display-name" className="block text-xs font-semibold text-white/50 uppercase tracking-widest mb-2">
              {role !== "recruiter" ? "Your Name / Stage Name" : "Your Name"}
            </label>
            <input
              id="ob-display-name"
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={role !== "recruiter" ? "Jordan M." : "Lisa Chen"}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 transition-colors"
            />
          </div>

          {/* Location */}
          <div>
            <label htmlFor="ob-location" className="block text-xs font-semibold text-white/50 uppercase tracking-widest mb-2">
              Location
            </label>
            <input
              id="ob-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Los Angeles, CA"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 transition-colors"
            />
          </div>

          {/* Creative-specific fields */}
          {(role === "dancer" || role === "creative") && (
            <>
              <div>
                <label htmlFor="ob-experience" className="block text-xs font-semibold text-white/50 uppercase tracking-widest mb-2">
                  Years of Experience
                </label>
                <input
                  id="ob-experience"
                  type="number"
                  min={0}
                  max={60}
                  value={experienceYears}
                  onChange={(e) =>
                    setExperienceYears(e.target.value === "" ? "" : parseInt(e.target.value, 10))
                  }
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 transition-colors"
                />
              </div>

              <div>
                <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-3">
                  Creative Disciplines
                </p>
                <div className="flex flex-wrap gap-2">
                  {CREATIVE_DISCIPLINES.map((style) => {
                    const selected = selectedStyles.includes(style);
                    return (
                      <button
                        key={style}
                        type="button"
                        onClick={() => toggleStyle(style)}
                        className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all border ${
                          selected
                            ? "bg-violet-600 border-violet-500 text-white"
                            : "bg-white/5 border-white/10 text-white/50 hover:text-white/80 hover:border-white/20"
                        }`}
                      >
                        {style}
                      </button>
                    );
                  })}
                </div>
                {selectedStyles.length > 0 && (
                  <p className="text-[11px] text-white/30 mt-2">
                    {selectedStyles.length} discipline{selectedStyles.length !== 1 ? "s" : ""} selected
                  </p>
                )}
              </div>
            </>
          )}

          {/* Recruiter-specific fields */}
          {role === "recruiter" && (
            <div>
              <label htmlFor="ob-company" className="block text-xs font-semibold text-white/50 uppercase tracking-widest mb-2">
                Company / Agency Name
              </label>
              <input
                id="ob-company"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Creative Artists Agency"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 transition-colors"
              />
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-[13px] text-red-400 leading-relaxed">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors text-sm tracking-tight"
        >
          {saving ? "Saving…" : "Get Started"}
        </button>
      </form>
    </div>
  );
}
