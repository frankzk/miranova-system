-- Importaciones (fase 3): seguimiento automático de la guía con 17TRACK. Se guarda lo último que
-- informa la paquetera; cada novedad nueva también queda en import_events.

alter table public.imports
  add column if not exists track_registered text,         -- número de guía registrado en 17TRACK
  add column if not exists track_status     text,         -- InTransit, Delivered, Exception…
  add column if not exists track_sub_status text,
  add column if not exists track_event      text,         -- última novedad de la paquetera
  add column if not exists track_event_at   timestamptz,
  add column if not exists track_eta        date,         -- llegada que estima la paquetera
  add column if not exists track_checked_at timestamptz,
  add column if not exists track_error      text;
