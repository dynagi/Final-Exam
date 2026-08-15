-- ============================================================
-- SecureAIExam — Patch 10: Paper-setter subject domains.
-- Run ONCE in the SQL Editor, after patch-9.
--
-- A paper setter chooses 2 subject domains at sign-up (submitted alongside
-- the account for Admin approval, same gate as patch-9). An Admin can grant
-- a setter additional domains later via POST /api/accounts/:id/domains.
--
-- Global to the account, not exam-scoped — unlike teacher_subjects, which is
-- per (exam, teacher). A setter's domains follow them across every exam.
-- ============================================================

create table if not exists public.setter_domains (
  setter_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null,
  -- null for the two domains chosen at sign-up; the admin's id for any
  -- granted later.
  assigned_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (setter_id, subject)
);

create index if not exists idx_setter_domains_setter on public.setter_domains (setter_id);

alter table public.setter_domains enable row level security;

drop policy if exists "admins manage setter domains" on public.setter_domains;
create policy "admins manage setter domains" on public.setter_domains
  for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

drop policy if exists "read own or privileged setter domains" on public.setter_domains;
create policy "read own or privileged setter domains" on public.setter_domains
  for select to authenticated
  using (setter_id = auth.uid() or public.get_my_role() = 'admin');

alter table public.setter_domains replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.setter_domains;
exception when duplicate_object then null;
end $$;
