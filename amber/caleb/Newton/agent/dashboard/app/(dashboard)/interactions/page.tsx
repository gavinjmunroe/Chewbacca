"use client";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  MessageSquare,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";

interface FeedItem {
  id: string;
  handle: string;
  displayName?: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export default function InteractionsPage() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const PAGE_SIZE = 30;

  useEffect(() => {
    setLoading(true);
    fetch(`/api/interactions?offset=0&limit=${PAGE_SIZE}`)
      .then((r) => r.json())
      .then((d) => {
        setFeed(d.items || []);
        setHasMore((d.items || []).length === PAGE_SIZE);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function loadMore() {
    const next = page + 1;
    fetch(`/api/interactions?offset=${next * PAGE_SIZE}&limit=${PAGE_SIZE}`)
      .then((r) => r.json())
      .then((d) => {
        const items = d.items || [];
        setFeed((prev) => [...prev, ...items]);
        setHasMore(items.length === PAGE_SIZE);
        setPage(next);
      });
  }

  function relativeTime(ts: string) {
    const diff = Date.now() - new Date(ts).getTime();
    const min = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (min < 60) return min <= 1 ? "just now" : `${min}m ago`;
    if (hrs < 24) return `${hrs}h ago`;
    return `${days}d ago`;
  }

  function nameFor(item: FeedItem) {
    return item.displayName || item.handle;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="w-5 h-5 text-indigo-400" />
          <h1 className="text-2xl font-bold text-zinc-50 tracking-tight">
            Feed
          </h1>
        </div>
        <p className="text-zinc-500 text-xs">
          All messages across every conversation.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl bg-zinc-900" />
          ))}
        </div>
      ) : feed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <MessageSquare className="w-8 h-8 text-zinc-700 mb-3" />
          <p className="text-zinc-600 text-sm">No conversations yet.</p>
        </div>
      ) : (
        <motion.div
          className="space-y-2"
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.025 } } }}
        >
          {feed.map((item) => {
            const isOutbound = item.role === "user";
            return (
              <motion.div
                key={item.id}
                variants={{
                  hidden: { opacity: 0, y: 6 },
                  visible: { opacity: 1, y: 0 },
                }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 hover:border-zinc-700 transition-all duration-150"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center ${
                      isOutbound
                        ? "bg-indigo-500/15 border border-indigo-500/25"
                        : "bg-zinc-800 border border-zinc-700"
                    }`}
                  >
                    {isOutbound ? (
                      <ArrowUpRight className="w-3 h-3 text-indigo-400" />
                    ) : (
                      <ArrowDownLeft className="w-3 h-3 text-zinc-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-zinc-300 truncate">
                        {nameFor(item)}
                      </span>
                      <span className="text-[11px] text-zinc-600 shrink-0">
                        {relativeTime(item.timestamp)}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">
                      {item.content}
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {!loading && hasMore && (
        <button
          onClick={loadMore}
          className="mt-6 w-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 text-sm font-medium py-2.5 rounded-xl transition-all duration-150 cursor-pointer"
        >
          Load more
        </button>
      )}
    </div>
  );
}
