-- ============================================================
-- SecureAIExam — Patch 6: Paper sets, and an unlimited question bank.
-- Run ONCE in the SQL Editor, after patch-5.
--
-- Changes the enforcement boundary set by patch-5:
--   * The QUESTION BANK is now unlimited. A setter may store 50, 500 or
--     5 000 Physics questions for an exam. Questions are still added through
--     POST /api/questions so their section / type / marks stay aligned with
--     the format, but there is no longer a cap.
--   * The FINAL PAPER is strict, and strict PER SET: every paper set must
--     hold exactly the number of questions of each type the exam format
--     defines — no more, no fewer.
--
-- Adds:
--   * exams.paper_set_count        how many sets the Admin wants (1..26)
--   * exams.allow_question_reuse   may a question appear in more than one set
--   * papers.set_label             'Set A', 'Set B', … one paper per set
-- ============================================================

/* ------------------------- exams: paper sets ---------------------------- */

alter table public.exams
  add column if not exists paper_set_count int not null default 1,
  add column if not exists allow_question_reuse boolean not null default false;

do $$
begin
  alter table public.exams
    add constraint exams_paper_set_count_chk check (paper_set_count between 1 and 26);
exception when duplicate_object then null;
end $$;

/* ------------------------- papers: which set ---------------------------- */

alter table public.papers
  add column if not exists set_label text;

-- One paper per (exam, set). The composer saves a set's selection
-- idempotently, so re-saving Set A updates that paper rather than piling up
-- half-finished duplicates.
create unique index if not exists papers_exam_set_uniq
  on public.papers (exam_id, set_label)
  where set_label is not null;

create index if not exists idx_papers_exam_set on public.papers (exam_id, set_label);

/* ------------------------- question reuse lookup ------------------------- */

-- Answering "which set already uses this question?" is a hot query on the
-- compose screen, and it is the join that enforces cross-set uniqueness.
create index if not exists idx_paper_questions_question
  on public.paper_questions (question_id);

/* ------------------------- setters may revise a draft -------------------- */

-- Saving a set replaces its question list, so the composer needs to clear the
-- previous rows. Restricted to the setter's own drafts; sealed papers are
-- immutable (their questions live in the ciphertext).
drop policy if exists "setters revise own draft" on public.paper_questions;
create policy "setters revise own draft" on public.paper_questions
  for delete to authenticated
  using (exists (
    select 1 from public.papers p
    where p.id = paper_id and p.setter_id = auth.uid() and p.status = 'draft'
  ));

drop policy if exists "setters update own drafts" on public.papers;
create policy "setters update own drafts" on public.papers
  for update to authenticated
  using (auth.uid() = setter_id and status = 'draft')
  with check (auth.uid() = setter_id and status = 'draft');

/* ------------------------- backfill -------------------------------------- */

-- Existing single-paper exams become a one-set exam whose paper is Set A.
update public.exams set paper_set_count = 1 where paper_set_count is null;

update public.papers p
set set_label = 'Set A'
where p.set_label is null
  and p.exam_id is not null
  and not exists (
    select 1 from public.papers q
    where q.exam_id = p.exam_id and q.set_label = 'Set A' and q.id <> p.id
  )
  and p.id = (
    select min(q.id::text)::uuid from public.papers q where q.exam_id = p.exam_id
  );
