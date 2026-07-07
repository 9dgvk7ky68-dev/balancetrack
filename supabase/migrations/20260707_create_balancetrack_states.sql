create table if not exists public.balancetrack_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  app_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.balancetrack_states enable row level security;

drop policy if exists "Users can read own state" on public.balancetrack_states;
create policy "Users can read own state"
on public.balancetrack_states
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own state" on public.balancetrack_states;
create policy "Users can insert own state"
on public.balancetrack_states
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own state" on public.balancetrack_states;
create policy "Users can update own state"
on public.balancetrack_states
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
