"use client";
import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ dancers: any[]; jobs: any[]; camps: any[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = setTimeout(async () => {
      if (query.length < 2) { setResults(null); return; }
      setLoading(true);
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data);
      setLoading(false);
      setOpen(true);
    }, 300);
    return () => clearTimeout(handler);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative px-2.5 pb-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Escape" && setOpen(false)}
          placeholder="Search..."
          className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl pl-8 pr-3 py-2 text-[13px] text-white placeholder-white/25 focus:outline-none focus:border-violet-500/40"
        />
      </div>
      {open && results && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-[rgba(28,28,30,0.97)] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
          {loading && <p className="px-4 py-3 text-xs text-white/40">Searching...</p>}
          {!loading && !results.dancers.length && !results.jobs.length && !results.camps.length && (
            <p className="px-4 py-3 text-xs text-white/40">No results for &ldquo;{query}&rdquo;</p>
          )}
          {results.dancers.length > 0 && (
            <div>
              <p className="px-3 py-1.5 text-[10px] font-semibold text-white/30 uppercase tracking-widest bg-white/[0.03]">Dancers</p>
              {results.dancers.map((d: any) => (
                <Link key={d.id} href={`/dashboard/dancers/${d.id}`} onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.06] transition-colors">
                  <span className="text-sm text-white/80">{d.profile?.display_name}</span>
                </Link>
              ))}
            </div>
          )}
          {results.jobs.length > 0 && (
            <div>
              <p className="px-3 py-1.5 text-[10px] font-semibold text-white/30 uppercase tracking-widest bg-white/[0.03]">Jobs</p>
              {results.jobs.map((j: any) => (
                <Link key={j.id} href={`/dashboard/jobs/${j.id}`} onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.06] transition-colors">
                  <span className="text-sm text-white/80">{j.title}</span>
                </Link>
              ))}
            </div>
          )}
          {results.camps.length > 0 && (
            <div>
              <p className="px-3 py-1.5 text-[10px] font-semibold text-white/30 uppercase tracking-widest bg-white/[0.03]">Camps</p>
              {results.camps.map((c: any) => (
                <Link key={c.id} href={`/dashboard/camps/${c.id}`} onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.06] transition-colors">
                  <span className="text-sm text-white/80">{c.name}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
