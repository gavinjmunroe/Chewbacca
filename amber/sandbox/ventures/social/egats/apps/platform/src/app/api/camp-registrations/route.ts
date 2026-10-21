import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Dancer role only
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "dancer") {
    return NextResponse.json({ error: "Only dancers can register for camps" }, { status: 403 });
  }

  let body: {
    campId?: string;
    emergencyContact?: { name?: string; phone?: string; relationship?: string };
    dietaryRestrictions?: string;
    tshirtSize?: string;
    travelAssistance?: boolean;
    departureCity?: string;
    scholarshipRequest?: boolean;
    scholarshipEssay?: string;
    consents?: { terms?: boolean; photo?: boolean; conduct?: boolean };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const {
    campId,
    emergencyContact,
    dietaryRestrictions,
    tshirtSize,
    travelAssistance,
    departureCity,
    scholarshipRequest,
    scholarshipEssay,
    consents,
  } = body;

  // Validate required fields
  if (!campId) return NextResponse.json({ error: "campId is required" }, { status: 400 });

  if (!emergencyContact?.name?.trim()) {
    return NextResponse.json({ error: "Emergency contact name is required" }, { status: 400 });
  }
  if (!emergencyContact?.phone?.trim()) {
    return NextResponse.json({ error: "Emergency contact phone is required" }, { status: 400 });
  }
  if (!emergencyContact?.relationship?.trim()) {
    return NextResponse.json({ error: "Emergency contact relationship is required" }, { status: 400 });
  }
  if (!tshirtSize) {
    return NextResponse.json({ error: "T-shirt size is required" }, { status: 400 });
  }

  const validSizes = ["XS", "S", "M", "L", "XL", "XXL"];
  if (!validSizes.includes(tshirtSize)) {
    return NextResponse.json({ error: "Invalid t-shirt size" }, { status: 400 });
  }

  // Validate consents
  if (!consents?.terms || !consents?.photo || !consents?.conduct) {
    return NextResponse.json({ error: "All consent agreements are required" }, { status: 400 });
  }

  // Validate travel city if requested
  if (travelAssistance && !departureCity?.trim()) {
    return NextResponse.json(
      { error: "Departure city is required when requesting travel assistance" },
      { status: 400 }
    );
  }

  // Fetch camp
  const { data: camp } = await supabase
    .from("camps")
    .select("id, max_capacity, current_registered, is_sold_out, registration_deadline")
    .eq("id", campId)
    .single();

  if (!camp) return NextResponse.json({ error: "Camp not found" }, { status: 404 });

  // Check capacity
  if (camp.is_sold_out || (camp?.max_capacity && (camp.current_registered ?? 0) >= camp.max_capacity)) {
    return NextResponse.json({ error: "This camp is at capacity" }, { status: 409 });
  }

  // Check registration deadline
  if (new Date(camp.registration_deadline) < new Date()) {
    return NextResponse.json({ error: "Registration deadline has passed" }, { status: 400 });
  }

  // Get dancer profile
  const { data: dancer } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!dancer) {
    return NextResponse.json({ error: "Dancer profile not found" }, { status: 404 });
  }

  // Check for duplicate
  const { data: existing } = await supabase
    .from("camp_registrations")
    .select("id")
    .eq("camp_id", campId)
    .eq("dancer_id", dancer.id)
    .single();

  if (existing) {
    return NextResponse.json({ error: "You're already registered for this camp" }, { status: 409 });
  }

  // Build notes payload from form data
  const notesPayload = JSON.stringify({
    emergency_contact: emergencyContact,
    dietary_restrictions: dietaryRestrictions || null,
    tshirt_size: tshirtSize,
    scholarship_request: scholarshipRequest || false,
    scholarship_essay: scholarshipEssay || null,
    consents,
  });

  // Insert registration
  const { data: registration, error: insertError } = await supabase
    .from("camp_registrations")
    .insert({
      camp_id: campId,
      dancer_id: dancer.id,
      user_id: user.id,
      status: "registered",
      registration_fee_paid: false,
      travel_origin: travelAssistance ? departureCity?.trim() : null,
      scholarship_awarded: false,
      notes: notesPayload,
      reimbursement_status: travelAssistance ? "pending" : "not_requested",
    })
    .select()
    .single();

  if (insertError) {
    console.error("[API error]", insertError);
    return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
  }

  // Increment current_registered
  try {
    await supabase.rpc("increment_camp_registered", { p_camp_id: campId });
  } catch {
    // Non-critical — fall back to direct update
    await supabase
      .from("camps")
      .update({ current_registered: camp.current_registered + 1 })
      .eq("id", campId);
  }

  // Notify user of successful camp registration
  await supabase.from("notifications").insert({
    user_id: user.id,
    type: "camp_registration",
    title: "Camp Registration Confirmed",
    body: `You've been registered for the camp. Check your dashboard for details.`,
    data: { registration_id: registration.id, camp_id: campId },
  });

  return NextResponse.json(registration, { status: 201 });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: dancer } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!dancer) return NextResponse.json([]);

  const { data, error } = await supabase
    .from("camp_registrations")
    .select(
      "*, camp:camps(id, name, city, state, start_date, end_date, registration_deadline, is_sold_out)"
    )
    .eq("dancer_id", dancer.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[API error]", error);
    return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
  }
  return NextResponse.json(data);
}
