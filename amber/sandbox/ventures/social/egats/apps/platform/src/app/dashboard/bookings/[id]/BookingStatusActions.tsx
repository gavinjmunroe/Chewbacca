"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface Props {
  bookingId: string;
  status: string;
  isDancer: boolean;
  isRecruiter: boolean;
}

export default function BookingStatusActions({ bookingId, status, isDancer, isRecruiter }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function updateStatus(newStatus: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update status");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const showRecruiterComplete = isRecruiter && status === "confirmed";
  const showDancerAccept = isDancer && status === "pending";
  const showDancerDecline = isDancer && status === "pending";

  if (!showRecruiterComplete && !showDancerAccept && !showDancerDecline) return null;

  return (
    <div className="border-t border-white/5 pt-6 space-y-3">
      <h3 className="font-bold text-sm text-white/60 uppercase tracking-widest">Actions</h3>
      <div className="flex flex-wrap gap-3">
        {showRecruiterComplete && (
          <button
            onClick={() => updateStatus("completed")}
            disabled={loading}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Mark Complete
          </button>
        )}
        {showDancerAccept && (
          <button
            onClick={() => updateStatus("confirmed")}
            disabled={loading}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Accept
          </button>
        )}
        {showDancerDecline && (
          <button
            onClick={() => updateStatus("cancelled")}
            disabled={loading}
            className="flex items-center gap-2 bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 text-white/70 hover:text-red-400 font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
            Decline
          </button>
        )}
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}
