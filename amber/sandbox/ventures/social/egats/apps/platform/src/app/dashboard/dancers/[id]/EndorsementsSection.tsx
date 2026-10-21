"use client";
import { useState } from "react";
import { Plus, Minus, ThumbsUp } from "lucide-react";

const COMMON_SKILLS = [
  "Technical Precision",
  "Musicality",
  "Professionalism",
  "Stage Presence",
  "Teamwork",
  "Versatility",
  "Choreography",
  "Improvisation",
];

interface EndorsementItem {
  skill: string;
  count: number;
  endorsedByMe: boolean;
}

interface Props {
  dancerId: string;
  initialEndorsements: EndorsementItem[];
  canEndorse: boolean; // true if viewer is a recruiter (not the dancer themselves)
}

export default function EndorsementsSection({ dancerId, initialEndorsements, canEndorse }: Props) {
  const [endorsements, setEndorsements] = useState<EndorsementItem[]>(() => {
    // Merge initial data with COMMON_SKILLS so all skills are always shown
    const map = new Map(initialEndorsements.map((e) => [e.skill, e]));
    COMMON_SKILLS.forEach((skill) => {
      if (!map.has(skill)) {
        map.set(skill, { skill, count: 0, endorsedByMe: false });
      }
    });
    // Sort: any with count > 0 first, then alphabetical
    return Array.from(map.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.skill.localeCompare(b.skill);
    });
  });

  const [loading, setLoading] = useState<string | null>(null);

  async function handleEndorse(skill: string, currentlyEndorsed: boolean) {
    if (loading) return;
    setLoading(skill);

    // Optimistic update
    setEndorsements((prev) =>
      prev.map((e) =>
        e.skill === skill
          ? {
              ...e,
              endorsedByMe: !currentlyEndorsed,
              count: currentlyEndorsed ? e.count - 1 : e.count + 1,
            }
          : e
      )
    );

    try {
      const res = await fetch("/api/endorsements", {
        method: currentlyEndorsed ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dancerId, skill }),
      });
      if (!res.ok) {
        // Revert
        setEndorsements((prev) =>
          prev.map((e) =>
            e.skill === skill
              ? {
                  ...e,
                  endorsedByMe: currentlyEndorsed,
                  count: currentlyEndorsed ? e.count + 1 : e.count - 1,
                }
              : e
          )
        );
      }
    } catch {
      // Revert
      setEndorsements((prev) =>
        prev.map((e) =>
          e.skill === skill
            ? {
                ...e,
                endorsedByMe: currentlyEndorsed,
                count: currentlyEndorsed ? e.count + 1 : e.count - 1,
              }
            : e
        )
      );
    } finally {
      setLoading(null);
    }
  }

  const hasAny = endorsements.some((e) => e.count > 0);

  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-5">
      <h3 className="font-bold text-base mb-4 flex items-center gap-2">
        <ThumbsUp className="w-4 h-4 text-violet-400" />
        Endorsements
      </h3>

      {!hasAny && !canEndorse && (
        <p className="text-xs text-white/30 text-center py-3">No endorsements yet.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {endorsements
          .filter((e) => canEndorse || e.count > 0)
          .map((e) => (
            <div
              key={e.skill}
              className={`flex items-center gap-1.5 rounded-full border text-xs font-medium px-3 py-1.5 transition-all ${
                e.endorsedByMe
                  ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                  : e.count > 0
                  ? "bg-white/[0.06] border-white/15 text-white/70"
                  : "bg-white/[0.03] border-white/8 text-white/35"
              }`}
            >
              <span>
                {e.skill}
                {e.count > 0 && (
                  <span className={`ml-1 ${e.endorsedByMe ? "text-violet-400" : "text-white/40"}`}>
                    ({e.count})
                  </span>
                )}
              </span>
              {canEndorse && (
                <button
                  onClick={() => handleEndorse(e.skill, e.endorsedByMe)}
                  disabled={loading === e.skill}
                  title={e.endorsedByMe ? `Remove ${e.skill} endorsement` : `Endorse ${e.skill}`}
                  className={`ml-0.5 rounded-full flex items-center justify-center w-4 h-4 transition-all ${
                    loading === e.skill ? "opacity-50 cursor-wait" : "cursor-pointer hover:scale-110"
                  } ${
                    e.endorsedByMe
                      ? "bg-violet-500/30 text-violet-300 hover:bg-red-500/20 hover:text-red-400"
                      : "bg-white/10 text-white/50 hover:bg-violet-500/30 hover:text-violet-300"
                  }`}
                >
                  {e.endorsedByMe ? (
                    <Minus className="w-2.5 h-2.5" />
                  ) : (
                    <Plus className="w-2.5 h-2.5" />
                  )}
                </button>
              )}
            </div>
          ))}
      </div>

      {canEndorse && (
        <p className="text-[10px] text-white/20 mt-3">
          Click <Plus className="w-2.5 h-2.5 inline" /> to endorse a skill, <Minus className="w-2.5 h-2.5 inline" /> to remove your endorsement.
        </p>
      )}
    </div>
  );
}
