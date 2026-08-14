-- ============================================================
-- SecureAIExam — Patch 9: Account approval for teachers & paper setters.
-- Run ONCE in the SQL Editor, after patch-8.
--
-- Teacher and paper-setter sign-ups no longer get access immediately: the
-- account is created 'pending' and the Node service (and every RLS-backed
-- read the app relies on) treats a non-approved profile as unusable until an
-- Admin approves it. Admin and invigilator accounts are never self-serve
-- (invigilator is always provisioned by an Admin via POST /api/centers, and
-- admin sign-up is no longer offered at all — see server/src/index.js), so
-- both stay 'approved' from creation.
-- ============================================================

do $$
begin
  create type account_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

alter table public.profiles
  add column if not exists status account_status not null default 'approved';

-- ---------- New sign-ups start pending unless their role is exempt ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_role user_role;
begin
  v_role := coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'teacher');
  insert into public.profiles (id, full_name, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', 'Unnamed'),
    v_role,
    case when v_role in ('teacher', 'paper_setter') then 'pending' else 'approved' end
  );
  return new;
end;
$$;

-- Trigger already exists (schema.sql); CREATE OR REPLACE above is enough to
-- pick up the new body, no need to redefine the trigger itself.

-- ---------- Close the same gate at the RLS layer ----------
-- Every RLS policy in schema.sql keys off get_my_role() = '...' (or IN
-- (...)). Without this, a pending/rejected account's live Supabase session
-- could still read/write through supabase-js directly — the Node service's
-- requireRole() status check (server/src/index.js) never sees that traffic.
-- Returning null for a non-approved profile makes every one of those
-- policies fail to match, the same way an unknown role already would.
create or replace function public.get_my_role()
returns user_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and status = 'approved';
$$;

-- ---------- Backfill: accounts that predate this patch are grandfathered in ----------
update public.profiles set status = 'approved' where status is null;

create index if not exists idx_profiles_status on public.profiles (status) where status <> 'approved';
