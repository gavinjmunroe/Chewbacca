"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface AdminActionsProps {
  reportId: string;
}

export default function AdminActions({ reportId }: AdminActionsProps) {
  const [loading, setLoading] = useState<"resolved" | "dismissed" | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleAction(action: "resolved" | "dismissed") {
    setLoading(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      }
      setDone(true);
      // Refresh the server component so the resolved report disappears from the list
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(null);
    }
  }

  if (done) {
    return (
      <span className="text-xs text-white/30 italic">Action recorded. Refreshing…</span>
    );
  }

  return (
    <>
      <button
        onClick={() => handleAction("resolved")}
        disabled={!!loading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-semibold hover:bg-green-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading === "resolved" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5" />
        )}
        Resolve
      </button>
      <button
        onClick={() => handleAction("dismissed")}
        disabled={!!loading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 text-xs font-semibold hover:bg-white/10 hover:text-white/70 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading === "dismissed" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <XCircle className="w-3.5 h-3.5" />
        )}
        Dismiss
      </button>
      {error && (
        <span className="text-xs text-red-400 ml-1">{error}</span>
      )}
    </>
  );
}
