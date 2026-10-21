ALTER TABLE "user_profiles" ADD COLUMN "username" varchar(50);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_username_unique" UNIQUE("username");