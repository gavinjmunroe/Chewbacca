"use client";

import { useState } from "react";
import { Clock, X, AlertCircle } from "lucide-react";

interface WaitlistButtonProps {
  campId: string;
  initialOnWaitlist: boolean;
  initialPosition: number | null;
}

export default function WaitlistButton({ campId, initialOnWaitlist, initialPosition }: WaitlistButtonProps) {
  const [onWaitlist, setOnWaitlist] = useState(initialOnWaitlist);
  const [position, setPosition] = useState(initialPosition);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/camp-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to join waitlist");
        return;
      }
      setOnWaitlist(true);
      setPosition(data.position);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLeave() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/camp-waitlist?campId=${encodeURIComponent(campId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to leave waitlist");
        return;
      }
      setOnWaitlist(false);
      setPosition(null);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (onWaitlist && position !== null) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/25 rounded-xl px-5 py-4 text-amber-400">
          <Clock className="w-5 h-5 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">On Waitlist: Position #{position}</div>
            <div className="text-sm text-amber-400/70">We&apos;ll notify you if a spot opens up.</div>
          </div>
          <button
            onClick={handleLeave}
            disabled={loading}
            className="shrink-0 flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            {loading ? "Leaving..." : "Leave Waitlist"}
          </button>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-4 text-red-400 flex-1">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div>
            <div className="font-semibold">Sold Out</div>
            <div className="text-sm text-red-400/70">This camp is at capacity. Join the waitlist to be notified if a spot opens.</div>
          </div>
        </div>
        <button
          onClick={handleJoin}
          disabled={loading}
          className="shrink-0 flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-6 py-4 rounded-xl transition-colors text-sm disabled:opacity-50"
        >
          <Clock className="w-4 h-4" />
          {loading ? "Joining..." : "Join Waitlist"}
        </button>
      </div>
      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
