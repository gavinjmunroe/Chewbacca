export const revalidate = 60;
export const metadata = { title: 'EGATS | Bookings', robots: 'noindex' };
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BookOpen, Calendar, DollarSign, Download } from "lucide-react";
import { formatDate } from "@/lib/utils";
import ReviewButton from "./ReviewButton";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-blue-500/20 text-blue-400",
  in_progress: "bg-violet-500/20 text-violet-400",
  completed: "bg-green-500/20 text-green-400",
  cancelled: "bg-zinc-700/50 text-zinc-500",
};

type BookingRow = {
  id: string;
  role_title: string;
  status: string;
  start_date: string;
  end_date?: string;
  total_pay_cents?: number;
  platform_fee_cents?: number;
  recruiter?: { company_name: string; profile?: { display_name: string }; user_id: string } | null;
  dancer?: { profile?: { display_name: string; avatar_url?: string }; user_id: string } | null;
};

export default async function BookingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  let bookings: BookingRow[] = [];

  if (profile?.role === "dancer") {
    const { data: dancer } = await supabase.from("dancer_profiles").select("id").eq("user_id", user.id).single();
    if (dancer) {
      const { data } = await supabase
        .from("bookings")
        .select("*, recruiter:recruiter_profiles(company_name, user_id, profile:profiles(display_name))")
        .eq("dancer_id", dancer.id)
        .order("start_date", { ascending: false })
        .limit(50);
      bookings = (data as BookingRow[]) || [];
    }
  } else {
    const { data: recruiter } = await supabase.from("recruiter_profiles").select("id").eq("user_id", user.id).single();
    if (recruiter) {
      const { data } = await supabase
        .from("bookings")
        .select("*, dancer:dancer_profiles(user_id, profile:profiles(display_name, avatar_url))")
        .eq("recruiter_id", recruiter.id)
        .order("start_date", { ascending: false })
        .limit(50);
      bookings = (data as BookingRow[]) || [];
    }
  }

  const completedIds = bookings.filter(b => b.status === "completed").map(b => b.id);
  let reviewedSet = new Set<string>();
  if (completedIds.length > 0) {
    const { data: reviews } = await supabase
      .from("reviews")
      .select("booking_id")
      .eq("reviewer_id", user.id)
      .in("booking_id", completedIds);
    reviewedSet = new Set((reviews || []).map(r => r.booking_id));
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-1">Bookings</h1>
          <p className="text-white/40 text-sm">Your booking history and active engagements</p>
        </div>
        <a
          href="/api/export/bookings"
          className="flex items-center gap-2 text-sm text-white/50 hover:text-white/80 border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-xl transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </a>
      </div>

      {bookings.length === 0 ? (
        <div className="text-center py-20 bg-white/[0.02] border border-white/5 rounded-2xl">
          <BookOpen className="w-12 h-12 text-white/20 mx-auto mb-4" />
          <h3 className="font-bold text-lg mb-2">No bookings yet</h3>
          <p className="text-white/40 text-sm">Bookings appear here after a role is confirmed through EGATS.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking) => {
            const revieweeId = profile?.role === "dancer"
              ? booking.recruiter?.user_id
              : booking.dancer?.user_id;
            const revieweeName = profile?.role === "dancer"
              ? (booking.recruiter?.company_name || "Recruiter")
              : (booking.dancer?.profile?.display_name || "Dancer");
            const alreadyReviewed = reviewedSet.has(booking.id);

            return (
              <div key={booking.id} className="bg-white/[0.04] border border-white/10 rounded-2xl p-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h3 className="font-bold text-base mb-1">{booking.role_title}</h3>
                    <div className="text-sm text-white/40">
                      {profile?.role === "dancer"
                        ? booking.recruiter?.company_name
                        : booking.dancer?.profile?.display_name}
                    </div>
                  </div>
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full ${STATUS_STYLES[booking.status] || "bg-white/10 text-white/40"}`}>
                    {booking.status.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="flex flex-wrap gap-5 text-sm text-white/40">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {formatDate(booking.start_date)}
                    {booking.end_date && ` - ${formatDate(booking.end_date)}`}
                  </div>
                  {booking.total_pay_cents ? (
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-green-400" />
                      <span className="text-green-400">${(booking.total_pay_cents / 100).toLocaleString()}</span>
                      <span className="text-white/20">total</span>
                      {booking.platform_fee_cents && (
                        <span className="text-white/20 text-xs">(EGATS fee: ${(booking.platform_fee_cents / 100).toFixed(0)})</span>
                      )}
                    </div>
                  ) : null}
                  {booking.status === "completed" && revieweeId && !alreadyReviewed && (
                    <ReviewButton bookingId={booking.id} revieweeId={revieweeId} revieweeName={revieweeName} />
                  )}
                  {booking.status === "completed" && alreadyReviewed && (
                    <span className="text-xs text-green-400/70">Review submitted</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
