-- ============================================================
-- SecureAIExam — Patch 13: Fix handle_new_user() enum cast.
-- Run ONCE in the SQL Editor.
--
-- patch-9-account-approval.sql's handle_new_user() assigned an untyped CASE
-- expression ('pending'/'approved' literals with no cast) into profiles.status
-- (account_status enum). Postgres resolves that CASE's type as text and has
-- no implicit text→enum cast, so every teacher/paper-setter signup failed
-- with "Database error creating new user" (Postgres error 42804: column
-- "status" is of type account_status but expression is of type text). This
-- patch replaces the function with explicit ::account_status casts.
-- ============================================================

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
    case when v_role in ('teacher', 'paper_setter') then 'pending'::account_status else 'approved'::account_status end
  );
  return new;
end;
$$;
