-- DaBound — Supabase schema
--
-- Paste this whole file into your Supabase project:  Dashboard → SQL Editor → New query → Run.
-- It is safe to run twice (everything is "if not exists").
--
-- What lives here
--   routes        one row per route the admin draws (stops + road geometry inside "data")
--   jeepneys      one row per jeepney / GPS device, including its last known position
--   destinations  the destination suggestions the search box offers
--
-- The server keeps live GPS fixes in memory (they change every few seconds) and
-- writes the last known position into the jeepney row, so a restart shows where
-- each jeepney was last seen instead of an empty map.

create table if not exists public.routes (
  id         text primary key,
  name       text not null default '',
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.jeepneys (
  id         text primary key,
  name       text not null default '',
  route_id   text,
  active     boolean not null default true,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.destinations (
  id         text primary key,
  name       text not null default '',
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Lock the tables down. Row Level Security with *no* policies means:
--   * the anon key (what a browser would get) can read and write nothing;
--   * the service_role key used by the DaBound server bypasses RLS and works normally.
-- DaBound never ships a Supabase key to the browser, so "anon" is simply unused.
alter table public.routes       enable row level security;
alter table public.jeepneys     enable row level security;
alter table public.destinations enable row level security;
