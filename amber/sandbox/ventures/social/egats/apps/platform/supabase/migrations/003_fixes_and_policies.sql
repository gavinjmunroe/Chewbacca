-- ============================================================
-- Migration 003: Fixes and Policies
-- Covers:
--   1. increment_job_applications function
--   2. Fix update_ratings_on_review trigger (type mismatch)
--   3. Fix handle_new_user to prevent role injection
--   4. Missing RLS policies (camp_registrations, verification_records,
--      culture_circles, culture_circle_members, culture_challenges)
--   5. Counter triggers for culture tables
--   6. Notifications insert policy
--   7. create_notification helper function
-- ============================================================


-- ============================================================
-- 1. INCREMENT JOB APPLICATIONS FUNCTION
-- ============================================================

create or replace function public.increment_job_applications(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs
  set total_applications = total_applications + 1,
      updated_at = now()
  where id = p_job_id;
end;
$$;


-- ============================================================
-- 2. FIX update_ratings_on_review TRIGGER (type mismatch)
-- ============================================================
-- reviewee_id is profiles.id
-- dancer_profiles.user_id is also profiles.id
-- recruiter_profiles.user_id is also profiles.id
-- Join path: reviews -> bookings -> dancer_profiles/recruiter_profiles via user_id

create or replace function public.update_ratings_on_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reviewer_role = 'recruiter' then
    -- Dancer was reviewed by a recruiter - update dancer avg_rating
    update public.dancer_profiles
    set avg_rating = (
      select avg(r2.rating)
      from public.reviews r2
      join public.bookings b2 on b2.id = r2.booking_id
      join public.dancer_profiles dp2 on dp2.id = b2.dancer_id
      where dp2.user_id = new.reviewee_id
        and r2.reviewer_role = 'recruiter'
    )
    where user_id = new.reviewee_id;

  elsif new.reviewer_role = 'dancer' then
    -- Recruiter was reviewed by a dancer - update recruiter avg_rating
    update public.recruiter_profiles
    set avg_rating = (
      select avg(r2.rating)
      from public.reviews r2
      join public.bookings b2 on b2.id = r2.booking_id
      join public.recruiter_profiles rp2 on rp2.id = b2.recruiter_id
      where rp2.user_id = new.reviewee_id
        and r2.reviewer_role = 'dancer'
    )
    where user_id = new.reviewee_id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_review_created on public.reviews;
create trigger on_review_created
  after insert on public.reviews
  for each row execute procedure public.update_ratings_on_review();


-- ============================================================
-- 3. FIX handle_new_user - PREVENT ROLE INJECTION
-- ============================================================
-- Users may only self-assign dancer or recruiter.
-- verifier and admin must be assigned manually by an admin.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role        public.user_role;
  v_requested   text;
begin
  v_requested := new.raw_user_meta_data->>'role';

  -- Whitelist: only recruiter is trusted from signup metadata.
  -- Everything else (including verifier, admin, or missing) defaults to dancer.
  if v_requested = 'recruiter' then
    v_role := 'recruiter';
  else
    v_role := 'dancer';
  end if;

  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    v_role
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ============================================================
-- 4. MISSING RLS POLICIES
-- ============================================================

-- ----------------------------------------------------------
-- camp_registrations
-- ----------------------------------------------------------

create policy "camp_reg_dancer_read" on public.camp_registrations
  for select using (auth.uid() = user_id);

create policy "camp_reg_dancer_insert" on public.camp_registrations
  for insert with check (auth.uid() = user_id);

create policy "camp_reg_dancer_update" on public.camp_registrations
  for update using (auth.uid() = user_id);

-- ----------------------------------------------------------
-- verification_records
-- ----------------------------------------------------------

-- Anyone can read verification status (public trust signal)
create policy "verification_public_read" on public.verification_records
  for select using (true);

-- Only verifiers and admins may insert verification records
create policy "verification_verifier_insert" on public.verification_records
  for insert with check (
    auth.uid() = verifier_id
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('verifier', 'admin')
    )
  );

-- ----------------------------------------------------------
-- culture_circles
-- ----------------------------------------------------------

create policy "circles_public_read" on public.culture_circles
  for select using (true);

create policy "circles_auth_create" on public.culture_circles
  for insert with check (auth.uid() = created_by);

create policy "circles_owner_update" on public.culture_circles
  for update using (auth.uid() = created_by);

-- ----------------------------------------------------------
-- culture_circle_members
-- ----------------------------------------------------------

create policy "circle_members_public_read" on public.culture_circle_members
  for select using (true);

create policy "circle_members_self_manage" on public.culture_circle_members
  for all using (auth.uid() = user_id);

-- ----------------------------------------------------------
-- culture_challenges
-- ----------------------------------------------------------

create policy "challenges_public_read" on public.culture_challenges
  for select using (true);

-- Only admins may create challenges
create policy "challenges_admin_create" on public.culture_challenges
  for insert with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role = 'admin'
    )
  );


-- ============================================================
-- 5. COUNTER TRIGGERS FOR CULTURE TABLES
-- ============================================================

-- ----------------------------------------------------------
-- culture_circles.member_count
-- ----------------------------------------------------------

create or replace function public.update_circle_member_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    update public.culture_circles
    set member_count = member_count + 1
    where id = NEW.circle_id;
  elsif TG_OP = 'DELETE' then
    update public.culture_circles
    set member_count = greatest(0, member_count - 1)
    where id = OLD.circle_id;
  end if;
  return null;
end;
$$;

drop trigger if exists on_circle_member_change on public.culture_circle_members;
create trigger on_circle_member_change
  after insert or delete on public.culture_circle_members
  for each row execute procedure public.update_circle_member_count();

-- ----------------------------------------------------------
-- culture_posts.likes_count
-- ----------------------------------------------------------

create or replace function public.update_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    update public.culture_posts
    set likes_count = likes_count + 1
    where id = NEW.post_id;
  elsif TG_OP = 'DELETE' then
    update public.culture_posts
    set likes_count = greatest(0, likes_count - 1)
    where id = OLD.post_id;
  end if;
  return null;
end;
$$;

drop trigger if exists on_post_like_change on public.culture_post_likes;
create trigger on_post_like_change
  after insert or delete on public.culture_post_likes
  for each row execute procedure public.update_post_like_count();

-- ----------------------------------------------------------
-- culture_posts.comments_count
-- ----------------------------------------------------------

create or replace function public.update_post_comment_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    update public.culture_posts
    set comments_count = comments_count + 1
    where id = NEW.post_id;
  elsif TG_OP = 'DELETE' then
    update public.culture_posts
    set comments_count = greatest(0, comments_count - 1)
    where id = OLD.post_id;
  end if;
  return null;
end;
$$;

drop trigger if exists on_post_comment_change on public.culture_comments;
create trigger on_post_comment_change
  after insert or delete on public.culture_comments
  for each row execute procedure public.update_post_comment_count();

-- ----------------------------------------------------------
-- culture_challenges.entry_count (posts linked to a challenge)
-- ----------------------------------------------------------

create or replace function public.update_challenge_entry_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' and NEW.challenge_id is not null then
    update public.culture_challenges
    set entry_count = entry_count + 1
    where id = NEW.challenge_id;
  elsif TG_OP = 'DELETE' and OLD.challenge_id is not null then
    update public.culture_challenges
    set entry_count = greatest(0, entry_count - 1)
    where id = OLD.challenge_id;
  end if;
  return null;
end;
$$;

drop trigger if exists on_culture_post_challenge on public.culture_posts;
create trigger on_culture_post_challenge
  after insert or delete on public.culture_posts
  for each row execute procedure public.update_challenge_entry_count();

-- ----------------------------------------------------------
-- recruiter_profiles.total_bookings (was missing; dancer already had this)
-- ----------------------------------------------------------

create or replace function public.update_recruiter_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.status = 'completed' and OLD.status != 'completed' then
    update public.recruiter_profiles
    set total_bookings = total_bookings + 1,
        updated_at = now()
    where id = NEW.recruiter_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_booking_complete_recruiter on public.bookings;
create trigger on_booking_complete_recruiter
  after update on public.bookings
  for each row execute procedure public.update_recruiter_stats();


-- ============================================================
-- 6. NOTIFICATIONS INSERT POLICY (was missing write side)
-- ============================================================

create policy "notifications_own_insert" on public.notifications
  for insert with check (auth.uid() = user_id);


-- ============================================================
-- 7. CREATE NOTIFICATION HELPER FUNCTION
-- ============================================================

create or replace function public.create_notification(
  p_user_id uuid,
  p_type    text,
  p_title   text,
  p_body    text    default null,
  p_data    jsonb   default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, type, title, body, data)
  values (p_user_id, p_type, p_title, p_body, p_data);
end;
$$;
