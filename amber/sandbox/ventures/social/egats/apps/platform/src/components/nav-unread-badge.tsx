"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface NavUnreadBadgeProps {
  initialCount: number;
  userId: string;
}

export default function NavUnreadBadge({ initialCount, userId }: NavUnreadBadgeProps) {
  const [count, setCount] = useState(initialCount);
  const pathname = usePathname();

  // Reset count to 0 when user visits the notifications page
  useEffect(() => {
    if (pathname === "/dashboard/notifications") {
      setCount(0);
    }
  }, [pathname]);

  // Subscribe to new notification inserts for this user
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("nav-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          // Only increment if not currently on the notifications page
          setCount((prev) =>
            pathname === "/dashboard/notifications" ? prev : prev + 1
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, pathname]);

  if (count <= 0) return null;

  return (
    <>
      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
        {count > 9 ? "9+" : count}
      </span>
    </>
  );
}

/** Inline pill variant used next to the label text */
export function NavUnreadPill({ initialCount, userId }: NavUnreadBadgeProps) {
  const [count, setCount] = useState(initialCount);
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/dashboard/notifications") {
      setCount(0);
    }
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("nav-notifications-pill")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          setCount((prev) =>
            pathname === "/dashboard/notifications" ? prev : prev + 1
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, pathname]);

  if (count <= 0) return null;

  return (
    <span className="ml-auto text-[11px] font-semibold bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">
      {count > 9 ? "9+" : count}
    </span>
  );
}
