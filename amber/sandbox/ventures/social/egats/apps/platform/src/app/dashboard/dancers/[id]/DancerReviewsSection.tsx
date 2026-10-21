"use client";
import { useState } from "react";
import { Star, MessageSquare } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { Review } from "@/types/database";

interface Props {
  reviews: (Review & { reviewer?: { display_name: string; avatar_url?: string | null } })[];
}

export default function DancerReviewsSection({ reviews }: Props) {
  const [showAll, setShowAll] = useState(false);

  const avgRating =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : null;

  const visible = showAll ? reviews : reviews.slice(0, 3);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="font-bold text-xl">Reviews</h2>
        {avgRating !== null && (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={`avg-star-${i}`}
                  className={`w-4 h-4 ${
                    i < Math.round(avgRating)
                      ? "fill-amber-400 text-amber-400"
                      : "text-white/15"
                  }`}
                />
              ))}
            </div>
            <span className="text-sm font-semibold text-amber-400">
              {avgRating.toFixed(1)}
            </span>
            <span className="text-sm text-white/30">({reviews.length})</span>
          </div>
        )}
        <span className="text-sm text-white/40">from recruiters & collaborators</span>
      </div>

      {reviews.length === 0 ? (
        <div className="text-center py-10 bg-white/[0.02] border border-white/5 rounded-xl">
          <MessageSquare className="w-8 h-8 text-white/15 mx-auto mb-2" />
          <p className="text-sm text-white/30">No reviews yet.</p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {visible.map((rev) => (
              <div key={rev.id} className="bg-white/[0.03] border border-white/5 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {rev.reviewer?.avatar_url ? (
                      // eslint_disable-next-line @next/next/no-img-element
                      <img
                        src={rev.reviewer.avatar_url}
                        alt={rev.reviewer.display_name}
                        className="w-7 h-7 rounded-full object-cover border border-white/10"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-violet-500/20 flex items-center justify-center text-xs font-bold text-violet-300">
                        {(rev.reviewer?.display_name ?? "?").slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <span className="text-xs text-white/50 font-medium">
                      {rev.reviewer?.display_name ?? "Verified Recruiter"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={`star-${i}`}
                          className={`w-3.5 h-3.5 ${
                            i < rev.rating ? "fill-amber-400 text-amber-400" : "text-white/10"
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-white/25">{formatDate(rev.created_at)}</span>
                  </div>
                </div>
                {rev.content && (
                  <p className="text-sm text-white/60 leading-relaxed mb-3">
                    &ldquo;{rev.content}&rdquo;
                  </p>
                )}
                {rev.dimension_scores && (
                  <div className="flex flex-wrap gap-3 text-xs text-white/30">
                    {Object.entries(rev.dimension_scores as Record<string, number>).map(([dim, score]) => (
                      <span key={dim} className="bg-white/5 px-2 py-0.5 rounded-md">
                        {dim.replace("_", " ")}:{" "}
                        <span className="text-white/60 font-semibold">{score}/5</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {reviews.length > 3 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mt-4 text-sm text-violet-400 hover:text-violet-300 transition-colors font-semibold"
            >
              {showAll ? "Show fewer reviews" : `Show all ${reviews.length} reviews`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
