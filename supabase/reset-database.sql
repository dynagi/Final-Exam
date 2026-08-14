-- ============================================================
-- SecureAIExam — DESTRUCTIVE RESET
--
--   ⚠  THIS PERMANENTLY DELETES ALL APPLICATION DATA.  ⚠
--
-- Every question, paper, sealed ciphertext, printed copy, custody record,
-- alert, QR detection and audit entry is dropped. None of it is recoverable
-- from this script — take a backup first if any of it matters
-- (Supabase dashboard → Database → Backups).
--
-- Sealed papers are the sharp edge: paper_secrets holds the ONLY copy of a
-- sealed paper's ciphertext. Dropping it destroys those papers permanently,
-- even if you still know both passphrases.
--
-- WHAT THIS DELETES
--   * all 14 application tables in `public`, and their data
--   * the 8 application functions and every trigger that uses them
--   * the 5 application enum types
--
-- WHAT THIS PRESERVES
--   * auth.users — your login accounts survive untouched
--   * storage buckets, and anything else outside `public`
--
-- AFTER RUNNING THIS
--   1. Run supabase/schema.sql to rebuild the structure.
--   2. Run the profile backfill at the bottom of this file, so the surviving
--      accounts can sign in again (the signup trigger only fires for NEW
--      users, so without it every existing login gets "No profile").
--   3. Restart the crypto service; it should log "Database schema is up to date."
--
-- Order matters: the auth.users trigger goes first because it lives outside
-- `public` and would otherwise be left pointing at a dropped function.
-- ============================================================

-- ---------- 1. Trigger that lives outside the public schema ----------
drop trigger if exists on_auth_user_created on auth.users;

-- ---------- 2. Tables ----------
-- CASCADE clears the foreign keys, policies, indexes and remaining triggers
-- along with them, so the order of this list does not matter.
drop table if exists
  public.qr_detections,
  public.custody_events,
  public.alerts,
  public.paper_copies,
  public.exam_centers,
  public.exam_slots,
  public.teacher_subjects,
  public.paper_secrets,
  public.paper_questions,
  public.papers,
  public.questions,
  public.exams,
  public.profiles,
  public.audit_log
cascade;

-- ---------- 3. Functions ----------
drop function if exists public.write_audit(uuid, text, text, text, jsonb);
drop function if exists public.get_my_role();
drop function if exists public.handle_new_user();
drop function if exists public.audit_chain();
drop function if exists public.custody_chain();
drop function if exists public.custody_after_insert();
drop function if exists public.reset_paper_preview();
drop function if exists public.paper_status_audit();

-- ---------- 4. Enum types ----------
-- Last, because the tables above used them.
drop type if exists alert_severity;
drop type if exists copy_status;
drop type if exists paper_status;
drop type if exists question_status;
drop type if exists user_role;
drop type if exists account_status;

-- ---------- 5. Verify ----------
-- Expect zero rows. Anything listed here was not removed.
select table_name as leftover_table
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles','questions','papers','paper_questions','paper_secrets','exams',
    'teacher_subjects','exam_slots','paper_copies','exam_centers',
    'custody_events','alerts','qr_detections','audit_log'
  );


-- ============================================================
-- OPTIONAL — also delete every login account
--
-- Leave this commented out unless you really want to start from nothing.
-- It removes all users including your admin, and you will have to sign up
-- again from the app. Center/invigilator logins go too.
-- ============================================================
-- delete from auth.users;


-- ============================================================
-- RUN AFTER schema.sql — restore profiles for surviving accounts
--
-- The on_auth_user_created trigger only fires for NEW signups, so accounts
-- that already existed need their profile row recreated from the metadata
-- captured at signup. Safe to run more than once.
-- ============================================================
-- insert into public.profiles (id, full_name, role)
-- select u.id,
--        coalesce(u.raw_user_meta_data ->> 'full_name', 'Unnamed'),
--        coalesce((u.raw_user_meta_data ->> 'role')::user_role, 'teacher')
-- from auth.users u
-- on conflict (id) do nothing;
