-- ============================================================
-- SecureAIExam — Patch 11: Device GPS location on every custody scan.
-- Run ONCE in the SQL Editor, after patch-10.
--
-- Every scan that writes a custody_events row (invigilator scan-in via
-- POST /api/copies/scan, and leak-trace identification via
-- POST /api/forensics/identify) now carries the scanning device's GPS
-- coordinates, captured client-side at the moment of the scan and sent
-- alongside the QR payload. NULL when the device declined location
-- permission or none was available — the scan itself is never blocked on it.
-- ============================================================

alter table public.custody_events
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_accuracy_m double precision;

comment on column public.custody_events.latitude is 'Scanning device GPS latitude, captured at scan time.';
comment on column public.custody_events.longitude is 'Scanning device GPS longitude, captured at scan time.';
comment on column public.custody_events.location_accuracy_m is 'Reported GPS accuracy radius in meters, from the device.';
