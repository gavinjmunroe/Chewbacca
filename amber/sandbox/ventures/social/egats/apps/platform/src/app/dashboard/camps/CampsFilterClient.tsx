"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { MapPin, Calendar, Users, DollarSign, ArrowRight, CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/utils";

function CampCard({ camp, registered }: { camp: Record<string, unknown>; registered?: boolean }) {
  const spotsLeft = (camp.max_capacity as number) - (camp.current_registered as number);
  const pct = ((camp.current_registered as number) / (camp.max_capacity as number)) * 100;

  return (
    <Link
      href={`/dashboard/camps/${camp.id}`}
      className="block bg-white/[0.04] border border-white/10 rounded-2xl p-6 card-hover group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <h3 className="font-bold text-lg group-hover:text-violet-300 transition-colors">
              {camp.name as string}
            </h3>
            {registered && (
              <span className="flex items-center gap-1 text-xs bg-green-500/20 text-green-400 px-2.5 py-1 rounded-full font-semibold">
                <CheckCircle2 className="w-3 h-3" /> Registered
              </span>
            )}
            {(camp.is_sold_out as boolean) && !registered && (
              <span className="text-xs bg-red-500/20 text-red-400 px-2.5 py-1 rounded-full font-semibold">
                Sold Out
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-5 text-sm text-white/50 mb-4">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              {camp.city as string}
              {camp.state ? `, ${camp.state as string}` : ""}
              {camp.venue_name ? (
                <span className="text-white/30">&middot; {camp.venue_name as string}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              {formatDate(camp.start_date as string)}
              {camp.end_date !== camp.start_date
                ? ` – ${formatDate(camp.end_date as string)}`
                : ""}
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              {spotsLeft > 0 ? `${spotsLeft} spots left` : "Full"}
            </div>
            {(camp.travel_reimbursement_cap_cents as number) > 0 && (
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-green-400" />
                <span className="text-green-400">Travel reimbursement available</span>
              </div>
            )}
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden max-w-xs">
            <div
              className={`h-full rounded-full transition-all ${
                pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-violet-500"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-xs text-white/30 mt-1">
            {camp.current_registered as number}/{camp.max_capacity as number} registered &middot; Deadline:{" "}
            {formatDate(camp.registration_deadline as string)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="text-lg font-bold">
            {(camp.registration_fee_cents as number) === 0
              ? "Free"
              : `$${(camp.registration_fee_cents as number) / 100}`}
          </div>
          <div className="flex items-center gap-1 text-violet-400 text-sm font-semibold group-hover:gap-2 transition-all">
            View Details <ArrowRight className="w-4 h-4" />
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function CampsFilterClient({ camps }: { camps: Record<string, unknown>[] }) {
  const [search, setSearch] = useState("");
  const [upcomingOnly, setUpcomingOnly] = useState(true);

  const filtered = useMemo(() => {
    return camps.filter((c) => {
      const matchSearch =
        !search || (c.name as string).toLowerCase().includes(search.toLowerCase());
      const matchUpcoming =
        !upcomingOnly || new Date(c.start_date as string) >= new Date();
      return matchSearch && matchUpcoming;
    });
  }, [camps, search, upcomingOnly]);

  return (
    <>
      <div className="flex gap-3 flex-wrap mb-6">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search camps..."
          className="bg-white/[0.05] border border-white/10 rounded-xl px-4 py-2.5 text-sm flex-1 min-w-48 placeholder:text-white/30 focus:outline-none focus:border-violet-500/50"
        />
        <button
          onClick={() => setUpcomingOnly((v) => !v)}
          className={`px-4 py-2.5 rounded-xl text-sm border transition-colors ${
            upcomingOnly
              ? "bg-violet-500/20 border-violet-500/30 text-violet-300"
              : "bg-white/5 border-white/10 text-white/60 hover:text-white"
          }`}
        >
          Upcoming only
        </button>
      </div>

      {filtered.length ? (
        <div className="space-y-4">
          {filtered.map((camp) => (
            <CampCard key={camp.id as string} camp={camp} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-white/[0.02] border border-white/5 rounded-2xl">
          <Calendar className="w-12 h-12 text-white/20 mx-auto mb-4" />
          <h3 className="font-bold text-lg mb-2">No camps found</h3>
          <p className="text-white/40 text-sm">
            {search ? "Try a different search term." : "Check back soon. Camps are announced 6–8 weeks in advance."}
          </p>
        </div>
      )}
    </>
  );
}
