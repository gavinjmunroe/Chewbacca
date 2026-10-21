"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bell,
  Briefcase,
  Calendar,
  BookOpen,
  MessageSquare,
  Info,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import MarkReadButtons from "./MarkReadButtons";

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  read: boolean;
  created_at: string;
}

function notificationIcon(type: string) {
  switch (type) {
    case "message":
      return <MessageSquare className="w-4 h-4 text-violet-400" />;
    case "booking":
      return <Briefcase className="w-4 h-4 text-green-400" />;
    case "application":
      return <BookOpen className="w-4 h-4 text-blue-400" />;
    case "camp":
      return <Calendar className="w-4 h-4 text-orange-400" />;
    default:
      return <Info className="w-4 h-4 text-white/40" />;
  }
}

function iconBg(type: string) {
  switch (type) {
    case "message":     return "bg-violet-500/10 border-violet-500/20";
    case "booking":     return "bg-green-500/10 border-green-500/20";
    case "application": return "bg-blue-500/10 border-blue-500/20";
    case "camp":        return "bg-orange-500/10 border-orange-500/20";
    default:            return "bg-white/5 border-white/10";
  }
}

function isToday(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  if (isToday(dateStr)) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function NotificationList({ items }: { items: Notification[] }) {
  return (
    <div className="space-y-2">
      {items.map((n) => {
        const inner = (
          <div
            className={`flex items-start gap-4 px-4 py-4 rounded-2xl border transition-all ${
              n.read
                ? "bg-white/[0.02] border-white/[0.06]"
                : "bg-white/[0.05] border-white/[0.12]"
            }`}
          >
            {/* Icon */}
            <div className={`flex-shrink-0 w-9 h-9 rounded-xl border flex items-center justify-center mt-0.5 ${iconBg(n.type)}`}>
              {notificationIcon(n.type)}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <p className={`text-sm font-semibold leading-snug ${n.read ? "text-white/60" : "text-white"}`}>
                  {n.title}
                </p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] text-white/25 whitespace-nowrap">
                    {formatTime(n.created_at)}
                  </span>
                  {!n.read && (
                    <span className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0" />
                  )}
                </div>
              </div>
              <p className="text-xs text-white/40 mt-0.5 leading-relaxed">{n.body}</p>
              {!n.read && (
                <MarkReadButtons notificationId={n.id} hasUnread={false} />
              )}
            </div>
          </div>
        );

        return n.link ? (
          <Link key={n.id} href={n.link} className="block group">
            {inner}
          </Link>
        ) : (
          <div key={n.id}>{inner}</div>
        );
      })}
    </div>
  );
}

interface NotificationsClientProps {
  initialNotifications: Notification[];
  userId: string;
}

export default function NotificationsClient({
  initialNotifications,
  userId,
}: NotificationsClientProps) {
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);
  const [isClearing, setIsClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const router = useRouter();

  const handleClearOld = useCallback(async () => {
    setIsClearing(true);
    setClearError(null);
    try {
      const res = await fetch("/api/notifications/cleanup", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      // Remove read notifications from local state (cleanup API deletes >30d old ones;
      // refresh from server to get accurate state)
      router.refresh();
    } catch (err) {
      setClearError(err instanceof Error ? err.message : "Failed to clear notifications");
    } finally {
      setIsClearing(false);
    }
  }, [router]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev]);
          // Refresh server component data in the background so mark-read state stays fresh
          router.refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, router]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const readCount = notifications.filter((n) => n.read).length;
  const todayItems = notifications.filter((n) => isToday(n.created_at));
  const earlierItems = notifications.filter((n) => !isToday(n.created_at));

  return (
    <div className="min-h-screen bg-[#09090B] px-4 py-10 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-white/40 mt-0.5">
              {unreadCount} unread
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {readCount > 0 && (
            <button
              onClick={handleClearOld}
              disabled={isClearing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.14] rounded-xl text-[12px] font-medium text-white/40 hover:text-white/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="Delete read notifications older than 30 days"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isClearing ? "Clearing…" : "Clear old"}
            </button>
          )}
          {unreadCount > 0 && (
            <MarkReadButtons hasUnread={unreadCount > 0} />
          )}
        </div>
      </div>

      {/* Clear error */}
      {clearError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-6">
          <p className="text-red-400 text-sm">{clearError}</p>
        </div>
      )}

      {notifications.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-5">
            <Bell className="w-7 h-7 text-white/20" />
          </div>
          <p className="text-white/50 text-sm font-medium">No notifications yet</p>
          <p className="text-white/25 text-xs mt-1">
            You&apos;ll see booking updates, messages, and more here.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {todayItems.length > 0 && (
            <section>
              <p className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-3">Today</p>
              <NotificationList items={todayItems} />
            </section>
          )}
          {earlierItems.length > 0 && (
            <section>
              <p className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-3">Earlier</p>
              <NotificationList items={earlierItems} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
