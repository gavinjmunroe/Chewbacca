import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("reviews")
    .select("*, reviewer:profiles!reviewer_id(display_name, avatar_url)")
    .eq("reviewee_id", user.id)
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[API error]", error);
    return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { bookingId?: string; revieweeId?: string; rating?: number; dimensionScores?: Record<string, number>; content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { bookingId, revieweeId, rating, dimensionScores, content } = body;

  if (!bookingId || !revieweeId) return NextResponse.json({ error: "bookingId and revieweeId required" }, { status: 400 });
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(bookingId) || !uuidRegex.test(revieweeId)) {
    return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
  }
  if (rating === undefined || !Number.isInteger(rating) || rating < 1 || rating > 5) return NextResponse.json({ error: "Rating must be 1-5" }, { status: 400 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  // Fetch booking and verify the reviewer is a party to it
  const { data: booking } = await supabase.from("bookings")
    .select("*, dancer:dancer_profiles(user_id), recruiter:recruiter_profiles(user_id)")
    .eq("id", bookingId).single();

  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (booking.status !== "completed") return NextResponse.json({ error: "Can only review completed bookings" }, { status: 400 });

  const dancerUserId = (booking.dancer as { user_id: string } | null)?.user_id;
  const recruiterUserId = (booking.recruiter as { user_id: string } | null)?.user_id;
  if (user.id !== dancerUserId && user.id !== recruiterUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Prevent duplicate reviews
  const { data: existingReview } = await supabase
    .from("reviews")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("reviewer_id", user.id)
    .maybeSingle();

  if (existingReview) {
    return NextResponse.json({ error: "You have already reviewed this booking" }, { status: 409 });
  }

  const { data, error } = await supabase.from("reviews").insert({
    booking_id: bookingId,
    reviewer_id: user.id,
    reviewee_id: revieweeId,
    reviewer_role: profile.role,
    rating,
    dimension_scores: dimensionScores,
    content,
    is_public: true,
  }).select().single();

  if (error) {
    console.error("[API error]", error);
    return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
