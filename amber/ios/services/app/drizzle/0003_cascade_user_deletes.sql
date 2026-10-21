-- Convert ON DELETE NO ACTION foreign keys that reference users.id (and a
-- handful of related parents) to ON DELETE CASCADE so /api/account/delete
-- and any future user-purge job leaves no orphaned rows.
--
-- Idempotent: each FK is dropped IF EXISTS before being recreated, so this
-- can be re-run safely. Children of `persons` cascade through persons (and
-- persons cascades through users), so deleting a user removes the entire
-- subtree without explicit cleanup in the application layer.

-- ── users.id parents ────────────────────────────────────────────────────────

ALTER TABLE "anchors" DROP CONSTRAINT IF EXISTS "anchors_user_id_users_id_fk";
ALTER TABLE "anchors" ADD CONSTRAINT "anchors_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "insights" DROP CONSTRAINT IF EXISTS "insights_user_id_users_id_fk";
ALTER TABLE "insights" ADD CONSTRAINT "insights_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "persons" DROP CONSTRAINT IF EXISTS "persons_user_id_users_id_fk";
ALTER TABLE "persons" ADD CONSTRAINT "persons_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "pipeline_defs" DROP CONSTRAINT IF EXISTS "pipeline_defs_user_id_users_id_fk";
ALTER TABLE "pipeline_defs" ADD CONSTRAINT "pipeline_defs_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "pipeline_runs" DROP CONSTRAINT IF EXISTS "pipeline_runs_user_id_users_id_fk";
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "relationships" DROP CONSTRAINT IF EXISTS "relationships_user_id_users_id_fk";
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "vc_records" DROP CONSTRAINT IF EXISTS "vc_records_user_id_users_id_fk";
ALTER TABLE "vc_records" ADD CONSTRAINT "vc_records_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "circles" DROP CONSTRAINT IF EXISTS "circles_owner_id_users_id_fk";
ALTER TABLE "circles" ADD CONSTRAINT "circles_owner_id_users_id_fk"
  FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "device_tokens" DROP CONSTRAINT IF EXISTS "device_tokens_user_id_users_id_fk";
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_user_id_users_id_fk";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "onboarding_progress" DROP CONSTRAINT IF EXISTS "onboarding_progress_user_id_users_id_fk";
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "personality_profiles" DROP CONSTRAINT IF EXISTS "personality_profiles_user_id_users_id_fk";
ALTER TABLE "personality_profiles" ADD CONSTRAINT "personality_profiles_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "signals" DROP CONSTRAINT IF EXISTS "signals_source_user_id_users_id_fk";
ALTER TABLE "signals" ADD CONSTRAINT "signals_source_user_id_users_id_fk"
  FOREIGN KEY ("source_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "signals" DROP CONSTRAINT IF EXISTS "signals_target_user_id_users_id_fk";
ALTER TABLE "signals" ADD CONSTRAINT "signals_target_user_id_users_id_fk"
  FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "signals" DROP CONSTRAINT IF EXISTS "signals_user_id_users_id_fk";
ALTER TABLE "signals" ADD CONSTRAINT "signals_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "user_profiles" DROP CONSTRAINT IF EXISTS "user_profiles_user_id_users_id_fk";
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_user_id_users_id_fk";
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "user_permissions" DROP CONSTRAINT IF EXISTS "user_permissions_user_id_users_id_fk";
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "permission_audit_log" DROP CONSTRAINT IF EXISTS "permission_audit_log_user_id_users_id_fk";
ALTER TABLE "permission_audit_log" ADD CONSTRAINT "permission_audit_log_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "circle_members" DROP CONSTRAINT IF EXISTS "circle_members_user_id_users_id_fk";
ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ── persons.id parents ──────────────────────────────────────────────────────

ALTER TABLE "wallets" DROP CONSTRAINT IF EXISTS "wallets_person_id_persons_id_fk";
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_person_id_persons_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "relationships" DROP CONSTRAINT IF EXISTS "relationships_from_id_persons_id_fk";
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_from_id_persons_id_fk"
  FOREIGN KEY ("from_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "relationships" DROP CONSTRAINT IF EXISTS "relationships_to_id_persons_id_fk";
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_to_id_persons_id_fk"
  FOREIGN KEY ("to_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "circle_members" DROP CONSTRAINT IF EXISTS "circle_members_person_id_persons_id_fk";
ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_person_id_persons_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ── circles.id, contacts.id, signals.id, pipeline_defs.id ───────────────────

ALTER TABLE "circle_members" DROP CONSTRAINT IF EXISTS "circle_members_circle_id_circles_id_fk";
ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_circle_id_circles_id_fk"
  FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "signals" DROP CONSTRAINT IF EXISTS "signals_contact_id_contacts_id_fk";
ALTER TABLE "signals" ADD CONSTRAINT "signals_contact_id_contacts_id_fk"
  FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_signal_id_signals_id_fk";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_signal_id_signals_id_fk"
  FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "pipeline_runs" DROP CONSTRAINT IF EXISTS "pipeline_runs_def_id_pipeline_defs_id_fk";
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_def_id_pipeline_defs_id_fk"
  FOREIGN KEY ("def_id") REFERENCES "public"."pipeline_defs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
