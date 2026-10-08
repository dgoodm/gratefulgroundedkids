-- ═══════════════════════════════════════════════════════════════
-- GRATEFUL & GROUNDED KIDS — admin dashboard database
--
-- Run once in Supabase: SQL Editor → New query → paste all of this → Run.
-- It is safe to run again; nothing is created twice and no data is removed.
-- ═══════════════════════════════════════════════════════════════

-- ── ADMIN ROLES ──
-- Who may use the dashboard. Signing in is not enough: the account also
-- needs a row here with the role 'admin' (see the last step at the bottom).
do $$ begin
  create type public.app_role as enum ('admin', 'moderator', 'user');
exception when duplicate_object then null;
end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

-- Runs with the owner's rights so the policies below can check roles
-- without tripping over the policy on user_roles itself
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

drop policy if exists "Users read own roles" on public.user_roles;
create policy "Users read own roles" on public.user_roles
  for select to authenticated
  using (auth.uid() = user_id);

-- ── LEADS ──
-- One row per contact form submission, or per lead added by hand.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  first_name text not null,
  last_name text,
  email text not null,
  phone text,
  topic text not null default 'General',
  message text,
  source text not null default 'website',
  stage text not null default 'new'
    check (stage in ('new', 'contacted', 'conversation', 'proposal', 'booked', 'closed')),
  follow_up_on date,
  estimated_value numeric(10, 2),
  notification_sent boolean not null default false,
  confirmation_sent boolean not null default false
);
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_stage_idx on public.leads (stage);
alter table public.leads enable row level security;

drop policy if exists "Admins manage leads" on public.leads;
create policy "Admins manage leads" on public.leads
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ── LEAD ACTIVITY ──
-- The history on each lead: notes, calls, emails, stage changes.
create table if not exists public.lead_activity (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  kind text not null default 'note'
    check (kind in ('note', 'email_sent', 'reply_received', 'call', 'stage_change', 'system')),
  body text
);
create index if not exists lead_activity_lead_idx on public.lead_activity (lead_id, created_at desc);
alter table public.lead_activity enable row level security;

drop policy if exists "Admins manage lead activity" on public.lead_activity;
create policy "Admins manage lead activity" on public.lead_activity
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ── HOUSEKEEPING ──
create or replace function public.touch_lead()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists leads_touch on public.leads;
create trigger leads_touch
  before update on public.leads
  for each row execute function public.touch_lead();

-- Any new activity marks the lead as recently touched
create or replace function public.bump_lead_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.leads set last_activity_at = now() where id = new.lead_id;
  return new;
end $$;

drop trigger if exists lead_activity_bump on public.lead_activity;
create trigger lead_activity_bump
  after insert on public.lead_activity
  for each row execute function public.bump_lead_activity();

-- ── ACCESS ──
-- Signed-in users reach the tables only through the admin policies above.
-- Visitors (the "anon" role) get nothing: the contact form saves leads from
-- the website's server function using the secret key, never from the browser.
grant usage on schema public to authenticated, service_role;
grant select on public.user_roles to authenticated;
grant select, insert, update, delete on public.leads, public.lead_activity to authenticated;
grant all on public.user_roles, public.leads, public.lead_activity to service_role;
revoke all on public.user_roles, public.leads, public.lead_activity from anon;

-- ═══════════════════════════════════════════════════════════════
-- LAST STEP — make yourself an admin
--
-- 1. In Supabase: Authentication → Users → Add user → Create new user.
--    Enter the email and a password, and tick "Auto Confirm User".
-- 2. Put that same email in the line below, remove the two dashes at
--    the start of each of the three lines, and run just those lines.
--
-- insert into public.user_roles (user_id, role)
-- select id, 'admin' from auth.users where email = 'you@example.com'
-- on conflict do nothing;
-- ═══════════════════════════════════════════════════════════════
