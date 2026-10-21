import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID_VISIBILITY = ["everyone", "verified_recruiters", "tier2_recruiters", "nobody"] as const;
type ProfileVisibility = (typeof VALID_VISIBILITY)[number];

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: existing, error } = await supabase
    .from("privacy_settings")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (existing) {
    return NextResponse.json(existing);
  }

  // No row yet — create defaults and return them
  const defaults = {
    user_id: user.id,
    profile_visible_to: "verified_recruiters" as ProfileVisibility,
    show_contact_info: false,
    show_phone: false,
    allow_ai_matching: true,
    allow_direct_messages: true,
  };

  const { data: created, error: createError } = await supabase
    .from("privacy_settings")
    .insert(defaults)
    .select()
    .single();

  if (createError) return NextResponse.json({ error: createError.message }, { status: 500 });
  return NextResponse.json(created);
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    profileVisibleTo?: string;
    showContactInfo?: boolean;
    showPhone?: boolean;
    allowAiMatching?: boolean;
    allowDirectMessages?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const {
    profileVisibleTo,
    showContactInfo,
    showPhone,
    allowAiMatching,
    allowDirectMessages,
  } = body;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (profileVisibleTo !== undefined) {
    if (!VALID_VISIBILITY.includes(profileVisibleTo as ProfileVisibility)) {
      return NextResponse.json(
        { error: `profileVisibleTo must be one of: ${VALID_VISIBILITY.join(", ")}` },
        { status: 400 }
      );
    }
    updates.profile_visible_to = profileVisibleTo;
  }

  if (showContactInfo !== undefined) {
    if (typeof showContactInfo !== "boolean") {
      return NextResponse.json({ error: "showContactInfo must be a boolean" }, { status: 400 });
    }
    updates.show_contact_info = showContactInfo;
  }

  if (showPhone !== undefined) {
    if (typeof showPhone !== "boolean") {
      return NextResponse.json({ error: "showPhone must be a boolean" }, { status: 400 });
    }
    updates.show_phone = showPhone;
  }

  if (allowAiMatching !== undefined) {
    if (typeof allowAiMatching !== "boolean") {
      return NextResponse.json({ error: "allowAiMatching must be a boolean" }, { status: 400 });
    }
    updates.allow_ai_matching = allowAiMatching;
  }

  if (allowDirectMessages !== undefined) {
    if (typeof allowDirectMessages !== "boolean") {
      return NextResponse.json({ error: "allowDirectMessages must be a boolean" }, { status: 400 });
    }
    updates.allow_direct_messages = allowDirectMessages;
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("privacy_settings")
    .upsert({ user_id: user.id, ...updates })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
