import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError || !profile)
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  let roleProfile = null;
  if (profile.role === "dancer") {
    const { data } = await supabase
      .from("dancer_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();
    roleProfile = { dancer_profile: data };
  } else if (profile.role === "recruiter") {
    const { data } = await supabase
      .from("recruiter_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();
    roleProfile = { recruiter_profile: data };
  }

  return NextResponse.json({ ...profile, ...roleProfile });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    display_name?: string;
    bio?: string;
    location?: string;
    website_url?: string;
    phone?: string;
    avatar_url?: string;
    instagram_handle?: string;
    tiktok_handle?: string;
    youtube_url?: string;
    username?: string;
    dancer?: Record<string, unknown>;
    recruiter?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // Explicitly strip `role` and other privileged fields from update payload
  // to prevent users from escalating their own role.
  const { display_name, bio, location, website_url, phone, avatar_url, instagram_handle, tiktok_handle, youtube_url, username, dancer, recruiter } = body;

  // Validate display_name if provided
  if (display_name !== undefined && typeof display_name !== "string") {
    return NextResponse.json({ error: "display_name must be a string" }, { status: 400 });
  }
  if (display_name !== undefined && display_name.trim().length === 0) {
    return NextResponse.json({ error: "display_name cannot be empty" }, { status: 400 });
  }

  // Fetch current profile to know the role
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile)
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  // Build profile update payload (only include defined fields)
  const profileUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (display_name !== undefined) profileUpdate.display_name = display_name.trim();
  if (bio !== undefined) profileUpdate.bio = bio;
  if (location !== undefined) profileUpdate.location = location;
  if (website_url !== undefined) profileUpdate.website_url = website_url;
  if (phone !== undefined) profileUpdate.phone = phone;
  if (avatar_url !== undefined) profileUpdate.avatar_url = avatar_url;
  if (instagram_handle !== undefined) profileUpdate.instagram_handle = instagram_handle || null;
  if (tiktok_handle !== undefined) profileUpdate.tiktok_handle = tiktok_handle || null;
  if (youtube_url !== undefined) profileUpdate.youtube_url = youtube_url || null;
  if (username !== undefined) {
    const usernameVal = username?.toLowerCase().trim() || null;
    if (usernameVal && !/^[a-z0-9_]{3,30}$/.test(usernameVal)) {
      return NextResponse.json({ error: "Invalid username format. Use 3-30 lowercase letters, numbers, or underscores." }, { status: 400 });
    }
    profileUpdate.username = usernameVal;
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update(profileUpdate)
    .eq("id", user.id);

  if (updateError) {
    console.error("[API error]", updateError);
    return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
  }

  // Update role-specific profile
  if (profile.role === "dancer" && dancer) {
    const {
      stage_name,
      styles,
      experience_years,
      availability_status,
      travel_willingness,
      height_cm,
      union_member,
      represented,
      represented_by,
    } = dancer;

    const dancerUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (stage_name !== undefined) dancerUpdate.stage_name = stage_name;
    if (styles !== undefined) dancerUpdate.styles = styles;
    if (experience_years !== undefined) dancerUpdate.experience_years = experience_years;
    if (availability_status !== undefined) dancerUpdate.availability_status = availability_status;
    if (travel_willingness !== undefined) dancerUpdate.travel_willingness = travel_willingness;
    if (height_cm !== undefined) dancerUpdate.height_cm = height_cm;
    if (union_member !== undefined) dancerUpdate.union_member = union_member;
    if (represented !== undefined) dancerUpdate.represented = represented;
    if (represented_by !== undefined) dancerUpdate.represented_by = represented_by;

    // Upsert: dancer_profile may not exist yet
    const { data: existing } = await supabase
      .from("dancer_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (existing) {
      const { error: dErr } = await supabase
        .from("dancer_profiles")
        .update(dancerUpdate)
        .eq("user_id", user.id);
      if (dErr) {
        console.error("[API error]", dErr);
        return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
      }
    } else {
      const { error: dErr } = await supabase
        .from("dancer_profiles")
        .insert({ user_id: user.id, ...dancerUpdate });
      if (dErr) {
        console.error("[API error]", dErr);
        return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
      }
    }
  }

  if (profile.role === "recruiter" && recruiter) {
    const { company_name, company_website, company_size, industry, recruiter_type, years_in_industry } = recruiter;

    const recruiterUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (company_name !== undefined) recruiterUpdate.company_name = company_name;
    if (company_website !== undefined) recruiterUpdate.website = company_website;
    if (recruiter_type !== undefined) recruiterUpdate.company_type = recruiter_type;
    if (years_in_industry !== undefined) recruiterUpdate.years_in_industry = years_in_industry;
    // company_size and industry require schema columns — included when available
    if (company_size !== undefined) recruiterUpdate.company_size = company_size;
    if (industry !== undefined) recruiterUpdate.industry = industry;

    const { data: existing } = await supabase
      .from("recruiter_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (existing) {
      const { error: rErr } = await supabase
        .from("recruiter_profiles")
        .update(recruiterUpdate)
        .eq("user_id", user.id);
      if (rErr) {
        console.error("[API error]", rErr);
        return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
      }
    } else {
      const { error: rErr } = await supabase
        .from("recruiter_profiles")
        .insert({ user_id: user.id, ...recruiterUpdate });
      if (rErr) {
        console.error("[API error]", rErr);
        return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
      }
    }
  }

  // Return updated profile
  const { data: updated } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return NextResponse.json(updated);
}
