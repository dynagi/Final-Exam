-- ============================================================
-- SecureAIExam — Patch 7: per-copy trace code for the QR watermark.
-- Run ONCE in the SQL Editor, after patch-6.
--
-- The header QR carries the full signed payload (~130 characters), which
-- makes a dense symbol — fine at 30 mm in the header, unreadable when tiled
-- faintly across a page. Each copy therefore also gets a SHORT trace code
-- that is tiled as a watermark behind the questions, so a photograph of any
-- fragment of the sheet still contains at least one complete, scannable
-- symbol identifying the copy.
--
-- The code is derived as base32(HMAC(SERVER_SECRET, 'trace:' || copy_id)),
-- so it is unguessable without the server secret and reproducible from the
-- copy id. It is stored as well as derived, so a scan resolves with a single
-- indexed lookup.
-- ============================================================

alter table public.paper_copies
  add column if not exists trace_code text;

create unique index if not exists paper_copies_trace_code_uniq
  on public.paper_copies (trace_code)
  where trace_code is not null;

-- Backfill is impossible from SQL alone (the codes are HMACs keyed by the
-- server secret), and copies printed before this patch simply carry no
-- watermark. Reprint them if watermark traceability is required.
