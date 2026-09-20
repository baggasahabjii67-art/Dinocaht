-- ============================================================
-- DINOCHAT GLOBAL DATABASE
-- FILE 5: database.sql
-- PostgreSQL / Supabase
-- ============================================================

-- ------------------------------------------------------------
-- EXTENSIONS
-- ------------------------------------------------------------

create extension if not exists pgcrypto;


-- ------------------------------------------------------------
-- ENUMS
-- ------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'friend_request_status'
  ) then
    create type friend_request_status as enum (
      'pending',
      'accepted',
      'rejected'
    );
  end if;

  if not exists (
    select 1 from pg_type where typname = 'social_content_type'
  ) then
    create type social_content_type as enum (
      'instagram',
      'snap'
    );
  end if;

  if not exists (
    select 1 from pg_type where typname = 'bet_status'
  ) then
    create type bet_status as enum (
      'waiting',
      'accepted',
      'active',
      'completed',
      'cancelled'
    );
  end if;
end
$$;


-- ============================================================
-- USERS
-- ============================================================

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),

  dino_id text not null unique,
  username text not null,

  dino_score numeric(12,2) not null default 0.10,
  score_tier text not null default 'D0.1',

  total_messages bigint not null default 0,
  total_snaps bigint not null default 0,
  total_photos bigint not null default 0,

  total_social_views bigint not null default 0,
  total_unique_social_views bigint not null default 0,

  scores_sent numeric(12,2) not null default 0,
  scores_received numeric(12,2) not null default 0,

  last_seen timestamptz,
  is_online boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_dino_id
  on public.users(dino_id);

create index if not exists idx_users_score
  on public.users(dino_score desc);

create index if not exists idx_users_last_seen
  on public.users(last_seen desc);


-- ============================================================
-- MESSAGES
-- ============================================================

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.users(id)
    on delete cascade,

  dino_id text not null,
  username text not null,

  content text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messages_created_at
  on public.messages(created_at desc);

create index if not exists idx_messages_user_id
  on public.messages(user_id);


-- ============================================================
-- SESSIONS
-- MAX 2 ACTIVE CONNECTIONS PER DINO ID
-- ============================================================

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.users(id)
    on delete cascade,

  dino_id text not null,

  token_hash text not null unique,

  device_info text,

  active boolean not null default true,

  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index if not exists idx_sessions_user
  on public.sessions(user_id);

create index if not exists idx_sessions_token
  on public.sessions(token_hash);

create index if not exists idx_sessions_active
  on public.sessions(active);


-- ============================================================
-- ACHIEVEMENTS
-- ============================================================

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),

  code text not null unique,
  name text not null,
  description text not null,

  icon text,

  created_at timestamptz not null default now()
);


create table if not exists public.user_achievements (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.users(id)
    on delete cascade,

  achievement_id uuid not null
    references public.achievements(id)
    on delete cascade,

  achieved_at timestamptz not null default now(),

  unique(user_id, achievement_id)
);

create index if not exists idx_user_achievements_user
  on public.user_achievements(user_id);


-- ============================================================
-- DAILY RANKINGS
-- ============================================================

create table if not exists public.daily_rankings (
  id uuid primary key default gen_random_uuid(),

  ranking_date date not null,

  user_id uuid not null
    references public.users(id)
    on delete cascade,

  dino_id text not null,

  rank integer not null,

  dino_score numeric(12,2) not null,

  captured_at timestamptz not null default now(),

  unique(ranking_date, user_id)
);

create index if not exists idx_daily_rankings_date
  on public.daily_rankings(ranking_date);

create index if not exists idx_daily_rankings_rank
  on public.daily_rankings(ranking_date, rank);


-- ============================================================
-- FRIEND REQUESTS
-- ============================================================

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),

  sender_id uuid not null
    references public.users(id)
    on delete cascade,

  receiver_id uuid not null
    references public.users(id)
    on delete cascade,

  status friend_request_status not null default 'pending',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check(sender_id <> receiver_id)
);

create index if not exists idx_friend_requests_receiver
  on public.friend_requests(receiver_id);

create index if not exists idx_friend_requests_sender
  on public.friend_requests(sender_id);

create index if not exists idx_friend_requests_status
  on public.friend_requests(status);


-- ============================================================
-- FRIENDSHIPS
-- ============================================================

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),

  user_a uuid not null
    references public.users(id)
    on delete cascade,

  user_b uuid not null
    references public.users(id)
    on delete cascade,

  created_at timestamptz not null default now(),

  check(user_a <> user_b),

  unique(user_a, user_b)
);

create index if not exists idx_friendships_a
  on public.friendships(user_a);

create index if not exists idx_friendships_b
  on public.friendships(user_b);


-- ============================================================
-- DINO SCORE TRANSFERS
-- ============================================================

create table if not exists public.score_transfers (
  id uuid primary key default gen_random_uuid(),

  sender_id uuid not null
    references public.users(id)
    on delete cascade,

  receiver_id uuid not null
    references public.users(id)
    on delete cascade,

  amount numeric(12,2) not null,

  created_at timestamptz not null default now(),

  check(sender_id <> receiver_id),
  check(amount > 0)
);

create index if not exists idx_score_transfers_sender
  on public.score_transfers(sender_id);

create index if not exists idx_score_transfers_receiver
  on public.score_transfers(receiver_id);


-- ============================================================
-- INSTAGRAM / SNAP CONTENT
-- ============================================================

create table if not exists public.social_content (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null
    references public.users(id)
    on delete cascade,

  owner_dino_id text not null,

  content_type social_content_type not null,

  url text not null,

  title text,

  active boolean not null default true,

  total_views bigint not null default 0,
  unique_views bigint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_social_content_owner
  on public.social_content(owner_id);

create index if not exists idx_social_content_created
  on public.social_content(created_at desc);

create index if not exists idx_social_content_active
  on public.social_content(active);


-- ============================================================
-- SOCIAL VIEWS
-- ONE DINO ID = ONE UNIQUE VIEW PER CONTENT
-- ============================================================

create table if not exists public.social_views (
  id uuid primary key default gen_random_uuid(),

  content_id uuid not null
    references public.social_content(id)
    on delete cascade,

  viewer_id uuid not null
    references public.users(id)
    on delete cascade,

  viewer_dino_id text not null,

  viewed_at timestamptz not null default now(),

  unique(content_id, viewer_id)
);

create index if not exists idx_social_views_content
  on public.social_views(content_id);

create index if not exists idx_social_views_viewer
  on public.social_views(viewer_id);


-- ============================================================
-- USER ACTION COUNTERS
-- ============================================================

create table if not exists public.user_action_counters (
  user_id uuid primary key
    references public.users(id)
    on delete cascade,

  snaps_sent bigint not null default 0,
  photos_sent bigint not null default 0,

  messages_sent bigint not null default 0,

  social_views_made bigint not null default 0,

  updated_at timestamptz not null default now()
);


-- ============================================================
-- CUSTOM UI LAYOUTS
-- COLORS ARE NOT STORED HERE
-- ============================================================

create table if not exists public.user_layouts (
  user_id uuid primary key
    references public.users(id)
    on delete cascade,

  layout_name text not null default 'classic',

  layout_data jsonb not null default '{}'::jsonb,

  updated_at timestamptz not null default now()
);


-- ============================================================
-- CHESS BETS
-- VIRTUAL DINO SCORE ONLY
-- ============================================================

create table if not exists public.chess_bets (
  id uuid primary key default gen_random_uuid(),

  creator_id uuid not null
    references public.users(id)
    on delete cascade,

  opponent_id uuid
    references public.users(id)
    on delete set null,

  creator_dino_id text not null,
  opponent_dino_id text,

  stake numeric(12,2) not null,

  status bet_status not null default 'waiting',

  winner_id uuid
    references public.users(id)
    on delete set null,

  game_data jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,

  check(stake > 0),
  check(creator_id <> opponent_id)
);

create index if not exists idx_chess_bets_creator
  on public.chess_bets(creator_id);

create index if not exists idx_chess_bets_opponent
  on public.chess_bets(opponent_id);

create index if not exists idx_chess_bets_status
  on public.chess_bets(status);


-- ============================================================
-- BET TRANSACTIONS
-- ============================================================

create table if not exists public.bet_transactions (
  id uuid primary key default gen_random_uuid(),

  bet_id uuid not null
    references public.chess_bets(id)
    on delete cascade,

  user_id uuid not null
    references public.users(id)
    on delete cascade,

  amount numeric(12,2) not null,

  transaction_type text not null,

  created_at timestamptz not null default now()
);

create index if not exists idx_bet_transactions_bet
  on public.bet_transactions(bet_id);

create index if not exists idx_bet_transactions_user
  on public.bet_transactions(user_id);


-- ============================================================
-- UPDATED_AT FUNCTION
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

drop trigger if exists users_updated_at
on public.users;

create trigger users_updated_at
before update on public.users
for each row
execute function public.set_updated_at();


drop trigger if exists messages_updated_at
on public.messages;

create trigger messages_updated_at
before update on public.messages
for each row
execute function public.set_updated_at();


drop trigger if exists friend_requests_updated_at
on public.friend_requests;

create trigger friend_requests_updated_at
before update on public.friend_requests
for each row
execute function public.set_updated_at();


drop trigger if exists social_content_updated_at
on public.social_content;

create trigger social_content_updated_at
before update on public.social_content
for each row
execute function public.set_updated_at();


drop trigger if exists user_layouts_updated_at
on public.user_layouts;

create trigger user_layouts_updated_at
before update on public.user_layouts
for each row
execute function public.set_updated_at();


-- ============================================================
-- SEED ACHIEVEMENTS
-- ============================================================

insert into public.achievements
  (code, name, description, icon)
values

  (
    'dino_of_day',
    'Dino of the Day',
    'Held the #1 Dino Score position for the required full-day period.',
    '👑'
  ),

  (
    'dino_top_3',
    'Top 3 Dino',
    'Reached the global Top 3.',
    '🏆'
  ),

  (
    'snap_10',
    'Snap Starter',
    'Sent 10 snaps.',
    '📸'
  ),

  (
    'snap_50',
    'Snap Master',
    'Sent 50 snaps.',
    '🔥'
  ),

  (
    'photo_50',
    'Photo Hunter',
    'Sent 50 photos.',
    '📷'
  ),

  (
    'social_views_100',
    'Social Explorer',
    'Viewed 100 social posts.',
    '👀'
  ),

  (
    'first_friend',
    'First Friend',
    'Successfully added your first friend.',
    '🤝'
  ),

  (
    'first_chess_win',
    'Chess Winner',
    'Won your first Dino Chess bet.',
    '♟️'
  ),

  (
    'score_sender',
    'Dino Supporter',
    'Sent Dino Score to another Dino.',
    '💰'
  ),

  (
    'dino_100',
    'Dino 100',
    'Reached Dino 100.',
    '💯'
  ),

  (
    'dino_1000',
    'Dino 1000',
    'Reached the maximum Dino Score level.',
    '🦖'
  )

on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon;


-- ============================================================
-- LIVE GLOBAL RANKING
-- ============================================================

create or replace view public.live_dino_rankings
as
select
  row_number() over (
    order by
      dino_score desc,
      created_at asc
  )::integer as rank,

  id,
  dino_id,
  username,
  dino_score,
  score_tier,
  total_messages,
  total_snaps,
  total_photos,
  total_social_views,
  is_online,
  last_seen,
  created_at

from public.users;


-- ============================================================
-- CLEAN STALE SESSIONS
-- ============================================================

create or replace function public.cleanup_stale_sessions()
returns void
language sql
security definer
as $$
  update public.sessions
  set active = false
  where active = true
    and last_seen < now() - interval '30 days';
$$;


-- ============================================================
-- BASIC DATABASE INDEXES
-- ============================================================

create index if not exists idx_users_online
  on public.users(is_online);

create index if not exists idx_users_username
  on public.users(lower(username));

create index if not exists idx_messages_dino
  on public.messages(dino_id);

create index if not exists idx_social_views_time
  on public.social_views(viewed_at desc);

create index if not exists idx_daily_rankings_user
  on public.daily_rankings(user_id);


-- ============================================================
-- SECURITY
--
-- The backend uses the server-side Supabase key.
-- We still enable RLS so the tables are not accidentally
-- exposed for unrestricted client-side access.
-- ============================================================

alter table public.users enable row level security;
alter table public.messages enable row level security;
alter table public.sessions enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.daily_rankings enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.score_transfers enable row level security;
alter table public.social_content enable row level security;
alter table public.social_views enable row level security;
alter table public.user_action_counters enable row level security;
alter table public.user_layouts enable row level security;
alter table public.chess_bets enable row level security;
alter table public.bet_transactions enable row level security;


-- ============================================================
-- IMPORTANT
--
-- No broad "anon can do everything" policies are created.
-- The Node/Express backend is responsible for application
-- access using the server-side key.
-- ============================================================


-- ============================================================
-- VERIFICATION
-- ============================================================

select
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'users',
    'messages',
    'sessions',
    'achievements',
    'user_achievements',
    'daily_rankings',
    'friend_requests',
    'friendships',
    'score_transfers',
    'social_content',
    'social_views',
    'user_action_counters',
    'user_layouts',
    'chess_bets',
    'bet_transactions'
  )
order by tablename;
