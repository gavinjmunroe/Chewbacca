-- ============================================================
-- MIGRATION 005: EGATS Culture App Tables
-- Social feed, circles, challenges, likes, comments
-- ============================================================

-- ── Culture Posts ────────────────────────────────────────────
create table if not exists culture_posts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(id) on delete cascade,
  circle_id        uuid,            -- nullable foreign key added after circles table
  content          text not null,
  media_url        text,
  styles           text[],
  likes_count      integer not null default 0,
  comments_count   integer not null default 0,
  is_pinned        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── Culture Circles ──────────────────────────────────────────
create table if not exists culture_circles (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  cover_image_url  text,
  styles           text[],
  member_count     integer not null default 0,
  post_count       integer not null default 0,
  created_by       uuid references profiles(id),
  is_official      boolean not null default false,
  created_at       timestamptz not null default now()
);

-- Add FK from culture_posts to circles
alter table culture_posts
  add constraint culture_posts_circle_id_fk
  foreign key (circle_id) references culture_circles(id) on delete set null;

-- ── Circle Members ───────────────────────────────────────────
create table if not exists culture_circle_members (
  id         uuid primary key default gen_random_uuid(),
  circle_id  uuid not null references culture_circles(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  unique(circle_id, user_id)
);

-- ── Culture Challenges ───────────────────────────────────────
create table if not exists culture_challenges (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  cover_image_url  text,
  start_date       date not null default current_date,
  end_date         date not null,
  prize            text,          -- text description of prize, if any
  submission_count integer not null default 0,
  styles           text[],
  is_active        boolean not null default true,
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now()
);

-- ── Post Likes ───────────────────────────────────────────────
create table if not exists culture_post_likes (
  id        uuid primary key default gen_random_uuid(),
  post_id   uuid not null references culture_posts(id) on delete cascade,
  user_id   uuid not null references profiles(id) on delete cascade,
  liked_at  timestamptz not null default now(),
  unique(post_id, user_id)
);

-- ── Post Comments ────────────────────────────────────────────
create table if not exists culture_post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references culture_posts(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);

-- ── Triggers: keep counts in sync ───────────────────────────

-- likes_count on culture_posts
create or replace function update_post_likes_count()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    update culture_posts set likes_count = likes_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update culture_posts set likes_count = greatest(likes_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_post_likes_count on culture_post_likes;
create trigger trg_post_likes_count
  after insert or delete on culture_post_likes
  for each row execute function update_post_likes_count();

-- comments_count on culture_posts
create or replace function update_post_comments_count()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    update culture_posts set comments_count = comments_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update culture_posts set comments_count = greatest(comments_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_post_comments_count on culture_post_comments;
create trigger trg_post_comments_count
  after insert or delete on culture_post_comments
  for each row execute function update_post_comments_count();

-- member_count on culture_circles
create or replace function update_circle_member_count()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    update culture_circles set member_count = member_count + 1 where id = new.circle_id;
  elsif tg_op = 'DELETE' then
    update culture_circles set member_count = greatest(member_count - 1, 0) where id = old.circle_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_circle_member_count on culture_circle_members;
create trigger trg_circle_member_count
  after insert or delete on culture_circle_members
  for each row execute function update_circle_member_count();

-- increment_circle_members RPC (used by the join route)
create or replace function increment_circle_members(circle_id uuid)
returns void language plpgsql security definer as $$
begin
  update culture_circles set member_count = member_count + 1 where id = circle_id;
end;
$$;

-- ── RLS ─────────────────────────────────────────────────────

alter table culture_posts enable row level security;
alter table culture_circles enable row level security;
alter table culture_circle_members enable row level security;
alter table culture_challenges enable row level security;
alter table culture_post_likes enable row level security;
alter table culture_post_comments enable row level security;

-- culture_posts: anyone can read, auth users can insert/update/delete own
create policy "culture_posts_select" on culture_posts for select using (true);
create policy "culture_posts_insert" on culture_posts for insert
  with check (auth.uid() = user_id);
create policy "culture_posts_update" on culture_posts for update
  using (auth.uid() = user_id);
create policy "culture_posts_delete" on culture_posts for delete
  using (auth.uid() = user_id);

-- culture_circles: publicly readable
create policy "culture_circles_select" on culture_circles for select using (true);
create policy "culture_circles_insert" on culture_circles for insert
  with check (auth.uid() = created_by);

-- culture_circle_members: publicly readable; auth users insert/delete own membership
create policy "ccm_select" on culture_circle_members for select using (true);
create policy "ccm_insert" on culture_circle_members for insert
  with check (auth.uid() = user_id);
create policy "ccm_delete" on culture_circle_members for delete
  using (auth.uid() = user_id);

-- culture_challenges: publicly readable; admins manage
create policy "challenges_select" on culture_challenges for select using (true);

-- likes: publicly readable; auth users manage own
create policy "likes_select" on culture_post_likes for select using (true);
create policy "likes_insert" on culture_post_likes for insert
  with check (auth.uid() = user_id);
create policy "likes_delete" on culture_post_likes for delete
  using (auth.uid() = user_id);

-- comments: publicly readable; auth users insert/delete own
create policy "comments_select" on culture_post_comments for select using (true);
create policy "comments_insert" on culture_post_comments for insert
  with check (auth.uid() = user_id);
create policy "comments_delete" on culture_post_comments for delete
  using (auth.uid() = user_id);

-- ── Seed: Default Circles ────────────────────────────────────
insert into culture_circles (name, description, styles, is_official)
values
  ('Hip-Hop Underground', 'The cypher never stops. Freestyles, battles, and bar sessions.', array['Hip-Hop', 'Breaking'], true),
  ('Contemporary Lab', 'Experimental movement, site-specific work, and postmodern conversations.', array['Contemporary', 'Modern'], true),
  ('Ballroom Scene', 'Voguing, waacking, and the full spectrum of ballroom culture.', array['Waacking', 'Vogue'], true),
  ('Commercial Dance', 'Music videos, tours, and industry tips from working professionals.', array['Commercial', 'Jazz Funk'], true),
  ('On-Camera Technique', 'Movement for the lens: film, TikTok, music video, and stage-to-screen.', array['Commercial'], true),
  ('Choreography Workshop', 'Share your pieces, get feedback, and find collaborators.', array[], true)
on conflict do nothing;
