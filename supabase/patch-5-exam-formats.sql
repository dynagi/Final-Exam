-- ============================================================
-- SecureAIExam — Patch 5: Exam formats, sections and strict
-- question-paper composition. Run ONCE in the SQL Editor.
--
-- Adds:
--   * exams.format_code / format_year / format_blueprint
--       The Admin picks a format + year; the Node service resolves the
--       blueprint from its catalogue and stores a copy here so every client
--       renders the same structure. The catalogue — never this copy — is the
--       authority when the server validates.
--   * papers.format_code / format_year / previewed_at
--       previewed_at is stamped by GET /api/papers/:id/preview and is a hard
--       precondition of sealing: a paper cannot be encrypted before the
--       setter has previewed and confirmed it.
--   * questions.section_name          which blueprint section a question fills
--   * questions.answer_numeric        answer key for numerical-value questions
--   * questions.correct_indices       answer key for multiple-select questions
--   * question_type widened to 'mcq' | 'msq' | 'numerical' | 'theoretical'
--   * teacher_subjects                per-exam subject assignment for teachers
--
-- Question inserts move from a client RLS policy to POST /api/questions on
-- the Node service, so the per-section quota cannot be bypassed by talking to
-- PostgREST directly. Teachers gain a delete policy for their own
-- not-yet-used questions so an over-quota bank can be corrected.
--
-- Safe to run on a project already patched through patch-4.
-- ============================================================

/* ------------------------- exams: format + year ------------------------- */

alter table public.exams
  add column if not exists format_code text,
  add column if not exists format_year int,
  add column if not exists format_blueprint jsonb;

create index if not exists idx_exams_format on public.exams (format_code, format_year);

/* ------------------------- papers: format + preview gate ---------------- */

alter table public.papers
  add column if not exists format_code text,
  add column if not exists format_year int,
  add column if not exists previewed_at timestamptz;

/* ------------------------- questions: sections + types ------------------ */

alter table public.questions
  add column if not exists section_name text,
  add column if not exists answer_numeric numeric,
  add column if not exists correct_indices jsonb;

create index if not exists idx_questions_section on public.questions (exam_id, section_name);

-- Widen the type vocabulary: numerical-value and multiple-select questions
-- are part of the JEE Main / GATE / UCEED patterns.
alter table public.questions drop constraint if exists questions_question_type_chk;
alter table public.questions
  add constraint questions_question_type_chk
  check (question_type in ('mcq', 'msq', 'numerical', 'theoretical'));

-- Per-type shape:
--   mcq         4 options + one correct index
--   msq         >= 2 options + a non-empty correct_indices array
--   numerical   no options, a numeric answer
--   theoretical free text, no key
alter table public.questions drop constraint if exists questions_shape_chk;
alter table public.questions
  add constraint questions_shape_chk
  check (
    (question_type = 'mcq'
      and jsonb_array_length(options) = 4
      and correct_index is not null)
    or (question_type = 'msq'
      and jsonb_array_length(options) >= 2
      and correct_indices is not null
      and jsonb_array_length(correct_indices) >= 1)
    or (question_type = 'numerical'
      and jsonb_array_length(options) = 0
      and answer_numeric is not null)
    or (question_type = 'theoretical')
  );

/* ------------------------- teacher subject assignment ------------------- */

-- When a teacher has rows here for an exam, their subject dropdown is
-- restricted to those subjects. No rows = every subject in the format.
create table if not exists public.teacher_subjects (
  exam_id uuid not null references public.exams (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null,
  assigned_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (exam_id, teacher_id, subject)
);

create index if not exists idx_teacher_subjects_teacher on public.teacher_subjects (teacher_id, exam_id);

alter table public.teacher_subjects enable row level security;

drop policy if exists "admins manage teacher subjects" on public.teacher_subjects;
create policy "admins manage teacher subjects" on public.teacher_subjects
  for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

drop policy if exists "read own or privileged teacher subjects" on public.teacher_subjects;
create policy "read own or privileged teacher subjects" on public.teacher_subjects
  for select to authenticated
  using (teacher_id = auth.uid() or public.get_my_role() in ('admin', 'paper_setter'));

/* ------------------------- questions: server-mediated insert ------------ */

-- The per-section quota (e.g. Physics = exactly 20 MCQ + 5 numerical) is
-- enforced in one place: POST /api/questions on the Node service, which holds
-- the format catalogue. Removing the client insert policy makes that the only
-- way in, so the frontend cannot be bypassed with a direct PostgREST call.
drop policy if exists "teachers insert own questions" on public.questions;

-- A teacher may withdraw their own question while it is still unused, so a
-- section that has hit its quota can be corrected.
drop policy if exists "teachers delete own unused questions" on public.questions;
create policy "teachers delete own unused questions" on public.questions
  for delete to authenticated
  using (
    auth.uid() = teacher_id
    and public.get_my_role() = 'teacher'
    and status in ('submitted', 'approved')
  );

/* ------------------------- preview gate ---------------------------------- */

-- Any change to a draft's question list invalidates a previous preview, so
-- the setter always confirms the paper they are actually sealing.
create or replace function public.reset_paper_preview()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_paper uuid := coalesce(new.paper_id, old.paper_id);
begin
  update public.papers
  set previewed_at = null
  where id = v_paper and status = 'draft' and previewed_at is not null;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_reset_paper_preview on public.paper_questions;
create trigger trg_reset_paper_preview
  after insert or update or delete on public.paper_questions
  for each row execute function public.reset_paper_preview();

/* ------------------------- realtime -------------------------------------- */

alter table public.teacher_subjects replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.teacher_subjects;
exception when duplicate_object then null;
end $$;
