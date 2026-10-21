"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { DimensionDots } from "@/components/dashboard/DimensionDots";
import { HealthGauge } from "@/components/dashboard/HealthGauge";
import { DIMENSIONS, DIMENSION_META, scoreColor } from "@/lib/health";
import {
  Search,
  X,
  MessageSquare,
  Clock,
  AlertCircle,
  Users,
} from "lucide-react";

interface Contact {
  handle: string;
  displayName?: string;
  relationship?: string;
  trustScore?: number;
  messageCount?: number;
  lastSeen?: string;
  notes?: string[];
  vibe?: string;
  social?: number;
  financial?: number;
  intellectual?: number;
  spiritual?: number;
  physical?: number;
  emotional?: number;
  overall_score?: number;
}

interface Detail {
  contact: Contact;
  messages: Array<{ role: string; content: string }>;
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/contacts?q=${encodeURIComponent(search)}`)
        .then((r) => r.json())
        .then((d) => {
          setContacts(d.contacts || []);
          setTotal(d.total || 0);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    fetch(`/api/contacts?handle=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((d) => {
        setDetail(d);
        setDetailLoading(false);
      })
      .catch(() => setDetailLoading(false));
  }, [selected]);

  const name = (c: Contact) => c.displayName || c.handle;

  function relativeTime(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    return `${days}d ago`;
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* List */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="shrink-0 px-5 pt-6 pb-4 border-b border-zinc-800/50">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-zinc-50 tracking-tight">
              Contacts
            </h1>
            <span className="text-xs text-zinc-600">{total} total</span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-8 pr-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-2xl bg-zinc-900" />
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="w-8 h-8 text-zinc-700 mb-3" />
              <p className="text-zinc-600 text-sm">No contacts found.</p>
            </div>
          ) : (
            <motion.div
              className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
            >
              {contacts.map((c) => (
                <motion.button
                  key={c.handle}
                  variants={{
                    hidden: { opacity: 0, y: 6 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  onClick={() =>
                    setSelected(selected === c.handle ? null : c.handle)
                  }
                  className={`bg-zinc-900 border rounded-2xl p-4 text-left transition-all duration-150 cursor-pointer hover:border-zinc-700 ${
                    selected === c.handle
                      ? "border-indigo-500/40 bg-indigo-500/5"
                      : "border-zinc-800"
                  }`}
                >
                  <div className="flex items-start justify-between mb-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-100 truncate">
                        {name(c)}
                      </p>
                      <p className="text-[11px] text-zinc-600 truncate">
                        {c.handle}
                      </p>
                    </div>
                    {c.overall_score != null && (
                      <span
                        className="text-sm font-bold shrink-0 ml-2"
                        style={{ color: scoreColor(c.overall_score) }}
                      >
                        {Number(c.overall_score).toFixed(1)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <DimensionDots
                      profile={c as unknown as Partial<Record<string, number>>}
                    />
                    <div className="flex gap-3 text-[11px] text-zinc-600">
                      {c.messageCount !== undefined && (
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          {c.messageCount}
                        </span>
                      )}
                      {c.lastSeen && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {relativeTime(c.lastSeen)}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.button>
              ))}
            </motion.div>
          )}
        </div>
      </div>

      {/* Detail drawer */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 360, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="shrink-0 border-l border-zinc-800 bg-zinc-950 overflow-hidden"
          >
            <div className="w-[360px] h-full flex flex-col overflow-hidden">
              <div className="shrink-0 px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
                <p className="text-sm font-semibold text-zinc-100 truncate">
                  {contacts.find((c) => c.handle === selected)
                    ? name(contacts.find((c) => c.handle === selected)!)
                    : selected}
                </p>
                <button
                  onClick={() => setSelected(null)}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer ml-2 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {detailLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton
                        key={i}
                        className="h-14 rounded-xl bg-zinc-900"
                      />
                    ))}
                  </div>
                ) : detail ? (
                  <>
                    {/* Trust + meta */}
                    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        {[
                          ["Relationship", detail.contact.relationship || "—"],
                          [
                            "Trust",
                            detail.contact.trustScore != null
                              ? (
                                  Number(detail.contact.trustScore) * 10
                                ).toFixed(1) + "/10"
                              : "—",
                          ],
                          [
                            "Messages",
                            String(detail.contact.messageCount || 0),
                          ],
                          ["Vibe", detail.contact.vibe || "—"],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <p className="text-zinc-600 mb-0.5">{k}</p>
                            <p className="text-zinc-300 font-medium truncate">
                              {v}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Notes */}
                    {detail.contact.notes &&
                      detail.contact.notes.length > 0 && (
                        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                          <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-2">
                            Notes
                          </p>
                          <ul className="space-y-1">
                            {detail.contact.notes.map((n, i) => (
                              <li
                                key={i}
                                className="text-xs text-zinc-400 flex gap-1.5"
                              >
                                <span className="text-zinc-700 shrink-0">
                                  •
                                </span>
                                {typeof n === "string"
                                  ? n
                                  : typeof n === "object" && n !== null
                                    ? ((n as Record<string, unknown>)
                                        .fact as string) || JSON.stringify(n)
                                    : String(n)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                    {/* Health gauges */}
                    {detail.contact.social !== undefined && (
                      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                        <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-3">
                          Health
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          {DIMENSIONS.map((d, i) => (
                            <HealthGauge
                              key={d}
                              score={(detail.contact[d] as number) || 0}
                              label={DIMENSION_META[d].label}
                              gender={DIMENSION_META[d].gender}
                              size={68}
                              delay={i * 0.05}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Conversation */}
                    {detail.messages && detail.messages.length > 0 && (
                      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                        <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-3">
                          Last {Math.min(detail.messages.length, 20)} messages
                        </p>
                        <div className="space-y-2 max-h-56 overflow-y-auto">
                          {detail.messages.slice(-20).map((m, i) => (
                            <div
                              key={i}
                              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                            >
                              <div
                                className={`max-w-[82%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                                  m.role === "user"
                                    ? "bg-indigo-600/80 text-white rounded-br-sm"
                                    : "bg-zinc-800 text-zinc-300 rounded-bl-sm"
                                }`}
                              >
                                {m.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
