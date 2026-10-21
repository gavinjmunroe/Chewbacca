"use client";
import { useState, useEffect, useCallback } from "react";
import { Star, MessageSquare } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface ReviewItem {
  id: string;
  rating: number;
  content: string | null;
  created_at: string;
  dimension_scores: Record<string, number> | null;
  reviewer: { display_name: string; avatar_url: string | null } | null;
}

export default function MyReviews() {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadReviews = useCallback(async () => {
    try {
      const r = await fetch("/api/reviews");
      const data = await r.json();
      if (Array.isArray(data)) setReviews(data);
    } catch {/* silently fail */} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const avgRating =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : null;

  if (loading) {
    return (
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6">
        <h2 className="font-bold text-base mb-4 flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-400" />
          My Reviews
        </h2>
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="font-bold text-base flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-400" />
          My Reviews
        </h2>
        {avgRating !== null && (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={`avg-${i}`}
                  className={`w-3.5 h-3.5 ${
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
            <span className="text-xs text-white/30">({reviews.length})</span>
          </div>
        )}
      </div>

      {reviews.length === 0 ? (
        <div className="text-center py-8 bg-white/[0.02] border border-white/5 rounded-xl">
          <MessageSquare className="w-7 h-7 text-white/15 mx-auto mb-2" />
          <p className="text-sm text-white/30">No reviews yet.</p>
          <p className="text-xs text-white/20 mt-1">Reviews appear here after completed bookings.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((rev) => (
            <div key={rev.id} className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {rev.reviewer?.avatar_url ? (
                    // eslint_disable-next-line @next/next/no-img-element
                    <img
                      src={rev.reviewer.avatar_url}
                      alt={rev.reviewer.display_name}
                      className="w-6 h-6 rounded-full object-cover border border-white/10"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center text-[10px] font-bold text-violet-300">
                      {(rev.reviewer?.display_name ?? "?").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="text-xs text-white/50">
                    {rev.reviewer?.display_name ?? "Anonymous"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={`star-${i}`}
                        className={`w-3 h-3 ${
                          i < rev.rating ? "fill-amber-400 text-amber-400" : "text-white/10"
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-white/25">{formatDate(rev.created_at)}</span>
                </div>
              </div>
              {rev.content && (
                <p className="text-sm text-white/60 leading-relaxed">
                  &ldquo;{rev.content}&rdquo;
                </p>
              )}
              {rev.dimension_scores && (
                <div className="flex flex-wrap gap-2 mt-2 text-xs text-white/30">
                  {Object.entries(rev.dimension_scores).map(([dim, score]) => (
                    <span key={dim} className="bg-white/5 px-2 py-0.5 rounded-md">
                      {dim.replace("_", " ")}:{" "}
                      <span className="text-white/50 font-semibold">{score}/5</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
