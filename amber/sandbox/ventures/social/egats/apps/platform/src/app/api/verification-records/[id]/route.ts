import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { VerificationTier } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string }> };

const verifierRateLimit = new Map<string, { count: number; resetAt: number }>();

export async function GET(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { data: record, error } = await supabase
    .from("verification_records")
    .select(
      `*, dancer:dancer_profiles(
        id, verification_tier, styles, experience_years,
        profile:profiles(display_name, avatar_url, location),
        clips:portfolio_clips(id, title, clip_url, thumbnail_url, styles, is_featured)
      ), camp:camps(name, city, state)`
    )
    .eq("id", id)
    .single();

  if (error || !record) return NextResponse.json({ error: "Record not found" }, { status: 404 });

  if (profile.role === "dancer") {
    const { data: dancer } = await supabase
      .from("dancer_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!dancer || (record as { dancer_id: string }).dancer_id !== dancer.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (profile.role !== "verifier" && profile.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(record);
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "verifier" && profile.role !== "admin")) {
    return NextResponse.json({ error: "Only verifiers can evaluate records" }, { status: 403 });
  }

  let body: { status?: string; decision?: string; evaluatorNotes?: string; notes?: string; dimensionScores?: Record<string, number>; scores?: Record<string, number> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // Accept both naming conventions for compatibility
  const status = (body.status ?? body.decision) as "approved" | "rejected" | undefined;
  const evaluatorNotes = (body.evaluatorNotes ?? body.notes ?? null) as string | null;
  const dimensionScores = (body.dimensionScores ?? body.scores ?? null) as Record<string, number> | null;

  if (!status || !["approved", "rejected"].includes(status)) {
    return NextResponse.json(
      { error: "status must be 'approved' or 'rejected'" },
      { status: 400 }
    );
  }

  const { data: record } = await supabase
    .from("verification_records")
    .select("id, dancer_id, tier_awarded, verifier_id, revoked")
    .eq("id", id)
    .single();

  if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  if (record.verifier_id) {
    return NextResponse.json({ error: "Record has already been evaluated" }, { status: 400 });
  }
  if (record.revoked) {
    return NextResponse.json({ error: "Record has been revoked" }, { status: 400 });
  }

  // Rate limiting: max 10 verifications per verifier per hour
  const userId = user.id;
  const now = Date.now();
  const rl = verifierRateLimit.get(userId) ?? { count: 0, resetAt: now + 3600_000 };
  if (now > rl.resetAt) { rl.count = 0; rl.resetAt = now + 3600_000; }
  rl.count++;
  verifierRateLimit.set(userId, rl);
  if (rl.count > 10) {
    return NextResponse.json({ error: "Rate limit exceeded. Please wait before submitting more verifications." }, { status: 429 });
  }

  // Map dimension scores to DB schema columns
  const scoreUpdates: Record<string, number> = {};
  if (dimensionScores) {
    if (dimensionScores.technique !== undefined) scoreUpdates.score_technique = dimensionScores.technique;
    if (dimensionScores.musicality !== undefined) scoreUpdates.score_on_camera = dimensionScores.musicality;
    if (dimensionScores.professionalism !== undefined) scoreUpdates.score_professionalism = dimensionScores.professionalism;
    if (dimensionScores.stage_presence !== undefined) scoreUpdates.score_collaboration = dimensionScores.stage_presence;
    if (dimensionScores.identity_verified !== undefined) scoreUpdates.score_communication = dimensionScores.identity_verified * 10;
    if (dimensionScores.attended_camp !== undefined) scoreUpdates.score_learning_speed = dimensionScores.attended_camp * 10;

    const scoreValues = Object.values(scoreUpdates);
    if (scoreValues.length > 0) {
      scoreUpdates.overall_score =
        Math.round((scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length) * 100) / 100;
    }
  }

  const updatePayload: Record<string, unknown> = {
    verifier_id: user.id,
    notes: evaluatorNotes?.trim() ?? null,
    verified_at: new Date().toISOString(),
    revoked: status === "rejected",
    ...scoreUpdates,
  };

  const { data: updated, error: updateError } = await supabase
    .from("verification_records")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (updateError) {
    console.error("[API error]", updateError);
    return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
  }

  if (status === "approved") {
    const awardedTier = parseInt(record.tier_awarded as string, 10);
    const newTier = Math.min(awardedTier, 2).toString() as VerificationTier;

    await supabase
      .from("dancer_profiles")
      .update({ verification_tier: newTier })
      .eq("id", record.dancer_id)
      .lt("verification_tier", String(newTier));

    const { data: dancer } = await supabase
      .from("dancer_profiles")
      .select("user_id")
      .eq("id", record.dancer_id)
      .single();

    if (dancer?.user_id) {
      const tierLabel = newTier === "1" ? "Verified Human" : "EGATS Verified Talent";
      await supabase.from("notifications").insert({
        user_id: dancer.user_id,
        type: "verification_approved",
        title: "Verification Approved",
        body: `Your Tier ${newTier} (${tierLabel}) verification was approved! Your profile now reflects your updated tier.`,
        data: { verification_record_id: id, tier_awarded: newTier },
      });
    }
  } else {
    const { data: dancer } = await supabase
      .from("dancer_profiles")
      .select("user_id")
      .eq("id", record.dancer_id)
      .single();

    if (dancer?.user_id) {
      await supabase.from("notifications").insert({
        user_id: dancer.user_id,
        type: "verification_rejected",
        title: "Verification Not Approved",
        body: evaluatorNotes?.trim()
          ? `Your verification request was not approved. Evaluator note: ${evaluatorNotes.trim()}`
          : "Your verification request was not approved at this time. Contact support for details.",
        data: { verification_record_id: id },
      });
    }
  }

  void logAuditEvent(
    supabase,
    status === "approved" ? "verification.approved" : "verification.rejected",
    user.id,
    { verification_record_id: id, dancer_id: record.dancer_id }
  );

  return NextResponse.json(updated);
}
