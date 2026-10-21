import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("profiles")
    .select("notification_email_bookings, notification_email_applications, notification_email_messages, notification_push_enabled")
    .eq("id", user.id)
    .single();

  // Return defaults if columns don't exist yet
  return NextResponse.json(data ?? {
    notification_email_bookings: true,
    notification_email_applications: true,
    notification_email_messages: true,
    notification_push_enabled: false,
  });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, boolean>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const allowed = ["notification_email_bookings", "notification_email_applications", "notification_email_messages", "notification_push_enabled"];
  const update: Record<string, boolean> = {};
  for (const key of allowed) {
    if (typeof body[key] === "boolean") update[key] = body[key];
  }

  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
