-- ══════════════════════════════════════════════════════════════════════════
-- Migration 0006: Route endpoint options
-- Adds per-endpoint icon and label visibility for routes.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE stops ADD COLUMN dest_icon TEXT;
ALTER TABLE stops ADD COLUMN show_start_label INTEGER NOT NULL DEFAULT 1;
ALTER TABLE stops ADD COLUMN show_dest_label INTEGER NOT NULL DEFAULT 1;
