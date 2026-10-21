"use client";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { useState } from "react";

interface Props {
  notificationId?: string;
  hasUnread: boolean;
}

export default function MarkReadButtons({ notificationId, hasUnread }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // "Mark all read" button
  if (hasUnread && !notificationId) {
    return (
      <button
        onClick={async () => {
          setLoading(true);
          await fetch("/api/notifications", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ all: true }),
          });
          router.refresh();
        }}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 disabled:opacity-50 transition-colors px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 hover:border-violet-400/30"
      >
        <CheckCheck className="w-3.5 h-3.5" />
        {loading ? "Marking…" : "Mark all read"}
      </button>
    );
  }

  // Per-notification inline mark-as-read
  if (notificationId) {
    return (
      <button
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setLoading(true);
          await fetch("/api/notifications", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: notificationId }),
          });
          router.refresh();
        }}
        disabled={loading}
        className="mt-2 text-[11px] text-white/30 hover:text-violet-400 disabled:opacity-50 transition-colors"
      >
        {loading ? "Marking…" : "Mark as read"}
      </button>
    );
  }

  return null;
}
