import { SupabaseClient } from "@supabase/supabase-js";

export type AuditAction =
  | "booking.created" | "booking.status_changed"
  | "application.created" | "application.status_changed"
  | "job.created" | "job.updated" | "job.deleted"
  | "verification.submitted" | "verification.approved" | "verification.rejected"
  | "account.deleted" | "profile.updated"
  | "report.created" | "report.resolved";

export async function logAuditEvent(
  supabase: SupabaseClient,
  action: AuditAction,
  actorId: string,
  metadata: Record<string, unknown> = {}
) {
  // Best-effort: don't throw if audit table doesn't exist yet
  await supabase.from("audit_log").insert({
    action,
    actor_id: actorId,
    metadata,
    created_at: new Date().toISOString(),
  }).then(({ error }) => {
    if (error && !error.message.includes("does not exist")) {
      console.error("[audit]", error.message);
    }
  });
}
