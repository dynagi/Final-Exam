-- ============================================================
-- SecureAIExam — Patch 12: Scope exam/question reads to Admin-granted
-- permissions.
-- Run ONCE in the SQL Editor, after patch-11.
--
-- Previously "authenticated read exams" and "setters and admins read all
-- questions" used `using (true)` / `role in (...)` with no per-row check, so
-- any approved teacher or paper setter could read every exam and (for
-- setters) every question in the system straight from Postgres, regardless
-- of teacher_subjects / setter_domains. The Node service already enforced
-- these grants at write time (POST /api/questions, POST /api/papers); this
-- patch closes the matching read-side gap so a teacher only sees exams an
-- Admin assigned them to (teacher_subjects), and a paper setter only sees
-- exams/questions in a domain an Admin granted them (setter_domains).
-- ============================================================

-- exams: admin sees everything; a teacher sees only exams they hold a
-- teacher_subjects row for; a paper setter sees only exams whose category is
-- one of their granted domains (an exam with no category is an
-- unenforced/custom format — nothing to check the setter's domains against,
-- so it stays visible, matching the POST /api/papers rule).
drop policy if exists "authenticated read exams" on public.exams;
drop policy if exists "scoped read exams" on public.exams;
create policy "scoped read exams" on public.exams
  for select to authenticated using (
    public.get_my_role() = 'admin'
    or (
      public.get_my_role() = 'teacher'
      and exists (
        select 1 from public.teacher_subjects ts
        where ts.exam_id = exams.id and ts.teacher_id = auth.uid()
      )
    )
    or (
      public.get_my_role() = 'paper_setter'
      and (
        exams.format_blueprint ->> 'category' is null
        or exists (
          select 1 from public.setter_domains sd
          where sd.setter_id = auth.uid()
            and sd.subject = exams.format_blueprint ->> 'category'
        )
      )
    )
  );

-- questions: a paper setter may only read/update questions that belong to an
-- exam in one of their granted domains (same category rule as above); a
-- teacher's own-row policies are unchanged.
drop policy if exists "setters and admins read all questions" on public.questions;
drop policy if exists "setters read questions in their domains" on public.questions;
create policy "setters read questions in their domains" on public.questions
  for select to authenticated using (
    public.get_my_role() = 'admin'
    or (
      public.get_my_role() = 'paper_setter'
      and exists (
        select 1 from public.exams e
        where e.id = questions.exam_id
          and (
            e.format_blueprint ->> 'category' is null
            or exists (
              select 1 from public.setter_domains sd
              where sd.setter_id = auth.uid()
                and sd.subject = e.format_blueprint ->> 'category'
            )
          )
      )
    )
  );

drop policy if exists "setters and admins update questions" on public.questions;
drop policy if exists "setters update questions in their domains" on public.questions;
create policy "setters update questions in their domains" on public.questions
  for update to authenticated using (
    public.get_my_role() = 'admin'
    or (
      public.get_my_role() = 'paper_setter'
      and exists (
        select 1 from public.exams e
        where e.id = questions.exam_id
          and (
            e.format_blueprint ->> 'category' is null
            or exists (
              select 1 from public.setter_domains sd
              where sd.setter_id = auth.uid()
                and sd.subject = e.format_blueprint ->> 'category'
            )
          )
      )
    )
  );
