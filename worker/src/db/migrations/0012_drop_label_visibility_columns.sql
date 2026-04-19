-- ══════════════════════════════════════════════════════════════════════════
-- Migration 0012: Drop show_start_label / show_dest_label (Task 17)
--
-- These columns were added in 0006 but never wired up to any route, shared
-- type, or frontend control. The "hide this marker and its label" use case
-- is already covered by the curated icon value 'none' (see shared/icons.ts),
-- and the label text itself is nullable — so these two INTEGER flags were
-- redundant and dead weight in every SELECT/INSERT.
--
-- D1 supports DROP COLUMN on SQLite >= 3.35.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE stops DROP COLUMN show_start_label;
ALTER TABLE stops DROP COLUMN show_dest_label;
