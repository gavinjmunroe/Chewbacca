-- EGATS Full Database Schema (idempotent / safe re-run)

create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";

-- ENUMS (safe)
do $$ begin create type user_role as enum ('dancer', 'recruiter', 'verifier', 'admin'); exception when duplicate_object then null; end $$;
do $$ begin create type verification_tier as enum ('0', '1', '2'); exception when duplicate_object then null; end $$;
do $$ begin create type application_status as enum ('pending', 'shortlisted', 'audition_requested', 'booked', 'rejected', 'withdrawn'); exception when duplicate_object then null; end $$;
do $$ begin create type booking_status as enum ('confirmed', 'in_progress', 'completed', 'cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type job_status as enum ('draft', 'open', 'filled', 'closed'); exception when duplicate_object then null; end $$;
do $$ begin create type camp_registration_status as enum ('registered', 'attended', 'no_show', 'cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type reimbursement_status as enum ('not_requested', 'pending', 'approved', 'paid', 'denied'); exception when duplicate_object then null; end $$;
do $$ begin create type recruiter_type as enum ('agency', 'production', 'brand', 'label', 'independent', 'casting', 'other'); exception when duplicate_object then null; end $$;
do $$ begin create type travel_willingness as enum ('local_only', 'regional', 'national', 'international'); exception when duplicate_object then null; end $$;
do $$ begin create type availability_status as enum ('available', 'limited', 'unavailable'); exception when duplicate_object then null; end $$;

-- TABLES
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'dancer',
  display_name text not null,
  avatar_url text,
  bio text,
  location text,
  instagram_handle text,
  tiktok_handle text,
  website_url text,
  phone text,
  is_verified_identity boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dancer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id) on delete cascade,
  stage_name text,
  styles text[] not null default '{}',
  height_cm integer,
  experience_years integer not null default 0,
  verification_tier verification_tier not null default '0',
  travel_willingness travel_willingness not null default 'regional',
  availability_status availability_status not null default 'available',
  union_member boolean not null default false,
  represented boolean not null default false,
  total_bookings integer not null default 0,
  avg_rating numeric(3,2),
  profile_complete boolean not null default false,
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists portfolio_clips (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references dancer_profiles(id) on delete cascade,
  title text not null,
  description text,
  clip_url text not null,
  thumbnail_url text,
  styles text[] not null default '{}',
  duration_seconds integer,
  is_featured boolean not null default false,
  view_count integer not null default 0,
  camp_generated boolean not null default false,
  verification_clip boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists recruiter_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id) on delete cascade,
  company_name text not null,
  company_type recruiter_type not null default 'independent',
  website text,
  is_verified boolean not null default false,
  verified_at timestamptz,
  total_bookings integer not null default 0,
  avg_rating numeric(3,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists camps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  city text not null,
  state text,
  country text not null default 'US',
  venue_name text,
  address text,
  start_date date not null,
  end_date date not null,
  registration_deadline date not null,
  max_capacity integer not null default 100,
  current_registered integer not null default 0,
  registration_fee_cents integer not null default 0,
  travel_reimbursement_cap_cents integer not null default 0,
  scholarship_spots integer not null default 0,
  description text,
  agenda jsonb,
  staff_ids uuid[],
  is_published boolean not null default false,
  is_sold_out boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists camp_registrations (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references camps(id) on delete cascade,
  dancer_id uuid not null references dancer_profiles(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  status camp_registration_status not null default 'registered',
  registration_fee_paid boolean not null default false,
  travel_origin text,
  travel_distance_miles integer,
  reimbursement_cap_cents integer,
  reimbursement_requested_cents integer,
  reimbursement_status reimbursement_status not null default 'not_requested',
  reimbursement_receipt_url text,
  scholarship_awarded boolean not null default false,
  check_in_time timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique(camp_id, dancer_id)
);

create table if not exists verification_records (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references dancer_profiles(id) on delete cascade,
  camp_id uuid references camps(id),
  verifier_id uuid references profiles(id),
  tier_awarded verification_tier not null,
  score_technique numeric(4,2),
  score_learning_speed numeric(4,2),
  score_professionalism numeric(4,2),
  score_collaboration numeric(4,2),
  score_on_camera numeric(4,2),
  score_communication numeric(4,2),
  overall_score numeric(4,2),
  styles_evaluated text[],
  notes text,
  evidence_clip_urls text[],
  verified_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references recruiter_profiles(id) on delete cascade,
  title text not null,
  description text not null,
  styles_needed text[] not null default '{}',
  role_type text not null,
  city text,
  state text,
  country text not null default 'US',
  remote_possible boolean not null default false,
  start_date date,
  end_date date,
  rehearsal_dates text,
  pay_range_min_cents integer,
  pay_range_max_cents integer,
  pay_type text not null default 'flat',
  min_verification_tier verification_tier not null default '0',
  head_count integer not null default 1,
  requirements text[],
  application_deadline date,
  status job_status not null default 'open',
  total_applications integer not null default 0,
  shortlisted_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  dancer_id uuid not null references dancer_profiles(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  status application_status not null default 'pending',
  cover_note text,
  submitted_clips text[],
  ai_match_score numeric(4,2),
  ai_match_reasons text[],
  shortlisted_at timestamptz,
  recruiter_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, dancer_id)
);

create table if not exists shortlists (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references recruiter_profiles(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  name text not null,
  dancer_ids uuid[] not null default '{}',
  notes text,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete set null,
  application_id uuid references applications(id) on delete set null,
  dancer_id uuid not null references dancer_profiles(id) on delete cascade,
  recruiter_id uuid not null references recruiter_profiles(id) on delete cascade,
  status booking_status not null default 'confirmed',
  role_title text not null,
  start_date date not null,
  end_date date,
  total_pay_cents integer,
  platform_fee_cents integer,
  notes text,
  contract_url text,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  reviewer_id uuid not null references profiles(id) on delete cascade,
  reviewee_id uuid not null references profiles(id) on delete cascade,
  reviewer_role user_role not null,
  rating integer not null check (rating between 1 and 5),
  dimension_scores jsonb,
  content text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  unique(booking_id, reviewer_id)
);

create table if not exists culture_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  performance_clip_url text not null,
  explanation_clip_url text not null,
  thumbnail_url text,
  caption text,
  credits text[],
  influences text[],
  styles text[] not null default '{}',
  challenge_id uuid,
  circle_id uuid,
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  views_count integer not null default 0,
  saves_count integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists culture_circles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  handle text not null unique,
  description text,
  type text not null default 'community',
  avatar_url text,
  banner_url text,
  member_count integer not null default 0,
  is_private boolean not null default false,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists culture_circle_members (
  circle_id uuid not null references culture_circles(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

create table if not exists culture_challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  explanation_prompt text not null,
  style_focus text[],
  banner_url text,
  sponsor_name text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  entry_count integer not null default 0,
  prize_description text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists culture_follows (
  follower_id uuid not null references profiles(id) on delete cascade,
  following_id uuid not null references profiles(id) on delete cascade,
  followed_at timestamptz not null default now(),
  primary key (follower_id, following_id)
);

create table if not exists culture_post_likes (
  post_id uuid not null references culture_posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  liked_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists culture_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references culture_posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  parent_id uuid references culture_comments(id) on delete cascade,
  likes_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- INDEXES (safe)
create index if not exists idx_dancer_profiles_styles on dancer_profiles using gin(styles);
create index if not exists idx_dancer_profiles_tier on dancer_profiles(verification_tier);
create index if not exists idx_dancer_profiles_availability on dancer_profiles(availability_status);
create index if not exists idx_portfolio_clips_dancer on portfolio_clips(dancer_id);
create index if not exists idx_jobs_status on jobs(status);
create index if not exists idx_jobs_styles on jobs using gin(styles_needed);
create index if not exists idx_applications_job on applications(job_id);
create index if not exists idx_applications_dancer on applications(dancer_id);
create index if not exists idx_bookings_dancer on bookings(dancer_id);
create index if not exists idx_bookings_recruiter on bookings(recruiter_id);
create index if not exists idx_culture_posts_user on culture_posts(user_id);
create index if not exists idx_culture_posts_styles on culture_posts using gin(styles);
create index if not exists idx_notifications_user on notifications(user_id, read);
create index if not exists idx_profiles_display_name on profiles using gin(display_name gin_trgm_ops);

-- RLS
alter table profiles enable row level security;
alter table dancer_profiles enable row level security;
alter table portfolio_clips enable row level security;
alter table recruiter_profiles enable row level security;
alter table camps enable row level security;
alter table camp_registrations enable row level security;
alter table verification_records enable row level security;
alter table jobs enable row level security;
alter table applications enable row level security;
alter table shortlists enable row level security;
alter table bookings enable row level security;
alter table reviews enable row level security;
alter table culture_posts enable row level security;
alter table culture_circles enable row level security;
alter table culture_circle_members enable row level security;
alter table culture_challenges enable row level security;
alter table culture_follows enable row level security;
alter table culture_post_likes enable row level security;
alter table culture_comments enable row level security;
alter table notifications enable row level security;

-- POLICIES (drop and recreate to avoid duplicates)
do $$ begin
  drop policy if exists "profiles_public_read" on profiles;
  drop policy if exists "profiles_own_write" on profiles;
  drop policy if exists "profiles_own_insert" on profiles;
  drop policy if exists "dancer_public_read" on dancer_profiles;
  drop policy if exists "dancer_own_write" on dancer_profiles;
  drop policy if exists "clips_public_read" on portfolio_clips;
  drop policy if exists "clips_own_write" on portfolio_clips;
  drop policy if exists "recruiter_public_read" on recruiter_profiles;
  drop policy if exists "recruiter_own_write" on recruiter_profiles;
  drop policy if exists "camps_public_read" on camps;
  drop policy if exists "jobs_public_read" on jobs;
  drop policy if exists "jobs_own_write" on jobs;
  drop policy if exists "applications_dancer_read" on applications;
  drop policy if exists "applications_dancer_write" on applications;
  drop policy if exists "applications_dancer_update" on applications;
  drop policy if exists "applications_recruiter_read" on applications;
  drop policy if exists "bookings_dancer_read" on bookings;
  drop policy if exists "bookings_recruiter_read" on bookings;
  drop policy if exists "reviews_public_read" on reviews;
  drop policy if exists "reviews_own_write" on reviews;
  drop policy if exists "culture_posts_public_read" on culture_posts;
  drop policy if exists "culture_posts_own_write" on culture_posts;
  drop policy if exists "follows_auth" on culture_follows;
  drop policy if exists "likes_auth" on culture_post_likes;
  drop policy if exists "comments_public_read" on culture_comments;
  drop policy if exists "comments_auth_write" on culture_comments;
  drop policy if exists "notifications_own" on notifications;
  drop policy if exists "shortlists_own" on shortlists;
end $$;

create policy "profiles_public_read" on profiles for select using (true);
create policy "profiles_own_write" on profiles for update using (auth.uid() = id);
create policy "profiles_own_insert" on profiles for insert with check (auth.uid() = id);
create policy "dancer_public_read" on dancer_profiles for select using (true);
create policy "dancer_own_write" on dancer_profiles for all using (auth.uid() = user_id);
create policy "clips_public_read" on portfolio_clips for select using (true);
create policy "clips_own_write" on portfolio_clips for all using (auth.uid() = (select user_id from dancer_profiles where id = dancer_id));
create policy "recruiter_public_read" on recruiter_profiles for select using (true);
create policy "recruiter_own_write" on recruiter_profiles for all using (auth.uid() = user_id);
create policy "camps_public_read" on camps for select using (is_published = true);
create policy "jobs_public_read" on jobs for select using (status = 'open');
create policy "jobs_own_write" on jobs for all using (auth.uid() = (select user_id from recruiter_profiles where id = recruiter_id));
create policy "applications_dancer_read" on applications for select using (auth.uid() = user_id);
create policy "applications_dancer_write" on applications for insert with check (auth.uid() = user_id);
create policy "applications_dancer_update" on applications for update using (auth.uid() = user_id);
create policy "applications_recruiter_read" on applications for select using (auth.uid() = (select rp.user_id from recruiter_profiles rp join jobs j on j.recruiter_id = rp.id where j.id = job_id));
create policy "bookings_dancer_read" on bookings for select using (auth.uid() = (select user_id from dancer_profiles where id = dancer_id));
create policy "bookings_recruiter_read" on bookings for select using (auth.uid() = (select user_id from recruiter_profiles where id = recruiter_id));
create policy "reviews_public_read" on reviews for select using (is_public = true);
create policy "reviews_own_write" on reviews for insert with check (auth.uid() = reviewer_id);
create policy "culture_posts_public_read" on culture_posts for select using (is_published = true);
create policy "culture_posts_own_write" on culture_posts for all using (auth.uid() = user_id);
create policy "follows_auth" on culture_follows for all using (auth.uid() = follower_id);
create policy "likes_auth" on culture_post_likes for all using (auth.uid() = user_id);
create policy "comments_public_read" on culture_comments for select using (true);
create policy "comments_auth_write" on culture_comments for insert with check (auth.uid() = user_id);
create policy "notifications_own" on notifications for all using (auth.uid() = user_id);
create policy "shortlists_own" on shortlists for all using (auth.uid() = (select user_id from recruiter_profiles where id = recruiter_id));

-- TRIGGER FUNCTION
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'dancer')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function update_dancer_stats()
returns trigger as $$
begin
  if new.status = 'completed' and old.status != 'completed' then
    update dancer_profiles set total_bookings = total_bookings + 1, updated_at = now() where id = new.dancer_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_booking_complete on bookings;
create trigger on_booking_complete after update on bookings for each row execute procedure update_dancer_stats();

create or replace function update_ratings_on_review()
returns trigger as $$
begin
  if new.reviewer_role = 'recruiter' then
    update dancer_profiles
    set avg_rating = (select avg(rating) from reviews r join bookings b on b.id = r.booking_id where b.dancer_id = new.reviewee_id::uuid and r.reviewer_role = 'recruiter')
    where user_id = new.reviewee_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_review_created on reviews;
create trigger on_review_created after insert on reviews for each row execute procedure update_ratings_on_review();
