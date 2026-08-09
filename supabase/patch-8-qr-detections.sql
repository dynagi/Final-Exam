-- ============================================================
-- SecureAIExam — Patch 8: frame-level QR watermarks and the security
-- events they raise. Run ONCE in the SQL Editor, after patch-7.
--
-- Patch 7 tiled ONE code across the sheet, so a photo told you WHICH COPY
-- but not which part of it. Every page is now divided into a fixed grid of
-- frames, each carrying its own QR, so a capture also pins down the page and
-- the frame — and therefore roughly what was photographed.
--
-- A frame token is  SAE:<trace12><page2><frame2><tag4>  where tag is an HMAC
-- over (copy_id, page, frame) keyed by the server secret. Nothing per-frame
-- is stored: the copy resolves through paper_copies.trace_code and the tag is
-- recomputed to prove the token was minted by this server. That keeps a
-- 500-copy print run from writing 36 000 rows nobody ever reads.
--
-- Detections ARE stored, one row per accepted event, with the metadata the
-- admin dashboard shows. Repeat sightings inside the dedup window bump a
-- counter on the existing row instead of inserting a new one, so a camera
-- staring at the same sheet cannot flood the dashboard.
-- ============================================================

create table if not exists public.qr_detections (
  id uuid primary key default gen_random_uuid(),

  -- What was seen. copy_id is null only if the token resolved but the copy
  -- was later deleted; the denormalised ids survive for the audit trail.
  copy_id uuid references public.paper_copies (id) on delete set null,
  paper_id uuid references public.papers (id) on delete set null,
  exam_id uuid references public.exams (id) on delete set null,
  exam_name text,
  set_label text,
  trace_code text not null,
  page_number int not null default 1,
  frame_number int not null default 1,
  frame_label text,
  qr_token text not null,

  -- When, and in whose clock.
  detected_at timestamptz not null default now(),
  timezone text,

  -- Who or what saw it.
  scanner_id text,
  device_info text,
  ip_address text,
  user_agent text,
  reported_by uuid references public.profiles (id),

  -- Where, when the scanner is willing and able to say.
  latitude double precision,
  longitude double precision,
  location_accuracy_m double precision,
  location_label text,

  -- Quality and provenance of the read.
  confidence numeric(5, 4),
  image_ref text,

  -- Deduplication: repeat sightings fold into one row.
  detection_count int not null default 1,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),

  alert_level alert_severity not null default 'critical',
  created_at timestamptz not null default now(),

  constraint qr_detections_confidence_chk
    check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists idx_detections_recent on public.qr_detections (detected_at desc);
create index if not exists idx_detections_copy on public.qr_detections (copy_id, detected_at desc);
create index if not exists idx_detections_exam on public.qr_detections (exam_id, detected_at desc);
create index if not exists idx_detections_trace on public.qr_detections (trace_code, detected_at desc);
-- The dedup lookup: same token, same scanner, recent.
create index if not exists idx_detections_dedup
  on public.qr_detections (qr_token, scanner_id, last_detected_at desc);

alter table public.qr_detections enable row level security;

-- Written only by the Node service (service role), which is the single place
-- that verifies a token's HMAC before recording anything.
drop policy if exists "admins read detections" on public.qr_detections;
create policy "admins read detections" on public.qr_detections
  for select to authenticated using (public.get_my_role() = 'admin');

alter table public.qr_detections replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.qr_detections;
exception when duplicate_object then null;
end $$;
