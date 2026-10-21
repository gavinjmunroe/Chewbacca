export const revalidate = 0;
export const metadata = { title: "EGATS | Booking Detail", robots: "noindex" };
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, DollarSign, Star, User } from "lucide-react";
import { formatDate } from "@/lib/utils";
import ReviewButton from "../ReviewButton";
import BookingStatusActions from "./BookingStatusActions";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-blue-500/20 text-blue-400",
  in_progress: "bg-violet-500/20 text-violet-400",
  completed: "bg-green-500/20 text-green-400",
  cancelled: "bg-zinc-700/50 text-zinc-500",
  pending: "bg-amber-500/20 text-amber-400",
};

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: booking } = await supabase
    .from("bookings")
    .select(`
      *,
      dancer:dancer_profiles(
        id, user_id, stage_name, avg_rating,
        profile:profiles(display_name, avatar_url)
      ),
      recruiter:recruiter_profiles(
        id, user_id, company_name,
        profile:profiles(display_name, avatar_url)
      ),
      job:jobs(title, pay_min_cents, pay_max_cents, pay_type)
    `)
    .eq("id", id)
    .single();

  if (!booking) notFound();

  // Guard: only the dancer or recruiter on this booking can view it
  const isDancer = booking.dancer?.user_id === user.id;
  const isRecruiter = booking.recruiter?.user_id === user.id;
  if (!isDancer && !isRecruiter) redirect("/dashboard/bookings");

  // Check if current user already left a review for this booking
  let existingReview: { rating: number; content: string | null } | null = null;
  if (booking.status === "completed") {
    const { data: rev } = await supabase
      .from("reviews")
      .select("rating, content")
      .eq("booking_id", id)
      .eq("reviewer_id", user.id)
      .maybeSingle();
    existingReview = rev ?? null;
  }

  const revieweeId = isDancer ? booking.recruiter?.user_id : booking.dancer?.user_id;
  const revieweeName = isDancer
    ? (booking.recruiter?.company_name || "Recruiter")
    : (booking.dancer?.profile?.display_name || "Dancer");

  const dancerName = booking.dancer?.stage_name || booking.dancer?.profile?.display_name || "Dancer";
  const recruiterName = booking.recruiter?.company_name || booking.recruiter?.profile?.display_name || "Recruiter";

  return (
    <div className="max-w-2xl space-y-8">
      <Link
        href="/dashboard/bookings"
        className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Bookings
      </Link>

      {/* Header */}
      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold mb-1">{booking.role_title}</h1>
            <p className="text-sm text-white/40">{recruiterName}</p>
          </div>
          <span
            className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
              STATUS_STYLES[booking.status] || "bg-white/10 text-white/40"
            }`}
          >
            {booking.status.replace(/_/g, " ")}
          </span>
        </div>

        {/* Details grid */}
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Dates */}
          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 text-white/40 text-xs mb-2">
              <Calendar className="w-3.5 h-3.5" /> Dates
            </div>
            <div className="font-semibold text-sm">
              {formatDate(booking.start_date)}
              {booking.end_date && booking.end_date !== booking.start_date
                ? ` – ${formatDate(booking.end_date)}`
                : ""}
            </div>
          </div>

          {/* Pay */}
          {booking.total_pay_cents ? (
            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
              <div className="flex items-center gap-2 text-white/40 text-xs mb-2">
                <DollarSign className="w-3.5 h-3.5" /> Pay Details
              </div>
              <div className="font-semibold text-sm text-green-400">
                ${(booking.total_pay_cents / 100).toLocaleString()} total
              </div>
              {booking.platform_fee_cents ? (
                <div className="text-xs text-white/30 mt-1">
                  EGATS platform fee: ${(booking.platform_fee_cents / 100).toLocaleString()}
                  {" "}
                  <span className="text-white/20">
                    ({((booking.platform_fee_cents / booking.total_pay_cents) * 100).toFixed(0)}%)
                  </span>
                </div>
              ) : null}
              {booking.platform_fee_cents ? (
                <div className="text-xs text-white/50 mt-0.5">
                  Net to dancer: ${((booking.total_pay_cents - booking.platform_fee_cents) / 100).toLocaleString()}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Parties */}
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Dancer */}
          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 text-white/40 text-xs mb-3">
              <User className="w-3.5 h-3.5" /> Dancer
            </div>
            <div className="flex items-center gap-3">
              {booking.dancer?.profile?.avatar_url ? (
                // eslint_disable-next-line @next/next/no-img-element
                <img
                  src={booking.dancer.profile.avatar_url}
                  alt={dancerName}
                  className="w-10 h-10 rounded-full object-cover border border-white/10"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-violet-500/30 flex items-center justify-center text-sm font-bold text-violet-300">
                  {dancerName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <div className="font-semibold text-sm">{dancerName}</div>
                {isRecruiter && (
                  <Link
                    href={`/dashboard/dancers/${booking.dancer?.id}`}
                    className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                  >
                    View profile
                  </Link>
                )}
              </div>
            </div>
          </div>

          {/* Recruiter */}
          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 text-white/40 text-xs mb-3">
              <User className="w-3.5 h-3.5" /> Recruiter
            </div>
            <div className="flex items-center gap-3">
              {booking.recruiter?.profile?.avatar_url ? (
                // eslint_disable-next-line @next/next/no-img-element
                <img
                  src={booking.recruiter.profile.avatar_url}
                  alt={recruiterName}
                  className="w-10 h-10 rounded-full object-cover border border-white/10"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-blue-500/30 flex items-center justify-center text-sm font-bold text-blue-300">
                  {recruiterName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <div className="font-semibold text-sm">{recruiterName}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        {booking.notes && (
          <div>
            <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">Notes</div>
            <p className="text-sm text-white/60 leading-relaxed bg-white/[0.02] border border-white/5 rounded-xl p-4">
              {booking.notes}
            </p>
          </div>
        )}

        {/* Status transition buttons */}
        <BookingStatusActions
          bookingId={id}
          status={booking.status}
          isDancer={isDancer}
          isRecruiter={isRecruiter}
        />

        {/* Review section */}
        {booking.status === "completed" && revieweeId && (
          <div className="border-t border-white/5 pt-6">
            <h3 className="font-bold text-base mb-4">Review</h3>
            {existingReview ? (
              <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-5">
                <div className="flex items-center gap-1 mb-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={`star-${i}`}
                      className={`w-4 h-4 ${
                        i < existingReview!.rating
                          ? "fill-amber-400 text-amber-400"
                          : "text-white/10"
                      }`}
                    />
                  ))}
                  <span className="text-xs text-white/40 ml-2">Your review</span>
                </div>
                {existingReview.content && (
                  <p className="text-sm text-white/60 leading-relaxed">
                    &ldquo;{existingReview.content}&rdquo;
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <p className="text-sm text-white/40">
                  How was your experience with {revieweeName}?
                </p>
                <ReviewButton
                  bookingId={id}
                  revieweeId={revieweeId}
                  revieweeName={revieweeName}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
