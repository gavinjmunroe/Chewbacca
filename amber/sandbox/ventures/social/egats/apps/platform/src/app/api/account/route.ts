import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";

/**
 * DELETE /api/account
 * Soft-deletes (or hard-deletes) the current authenticated user's account.
 * Expects body: { confirmation: "DELETE MY ACCOUNT" }
 */
export async function DELETE(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { confirmation?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.confirmation !== "DELETE MY ACCOUNT") {
    return NextResponse.json(
      { error: 'Please type "DELETE MY ACCOUNT" to confirm' },
      { status: 400 }
    );
  }

  // Anonymize the profile (GDPR-compliant soft delete)
  const deletedEmail = `deleted_${user.id}@deleted.egats.io`;
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      display_name: "Deleted User",
      bio: null,
      avatar_url: null,
      phone: null,
      website_url: null,
      location: null,
      email: deletedEmail,
    })
    .eq("id", user.id);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  void logAuditEvent(supabase, "account.deleted", user.id, { user_id: user.id });

  // Sign out the user immediately — the admin account delete must be done server-side
  // via Supabase Admin API which requires service_role key (not available here).
  // Profile anonymization is the GDPR-compliant approach.
  await supabase.auth.signOut();

  return NextResponse.json({ message: "Account deleted. You have been signed out." });
}
