-- Migration 0004: Unified map items (points + routes)
-- Adds type discriminator and destination fields to the stops table.
-- Existing rows become type='point'. Routes must be created manually.

ALTER TABLE stops ADD COLUMN type TEXT NOT NULL DEFAULT 'point';
ALTER TABLE stops ADD COLUMN dest_name TEXT;
ALTER TABLE stops ADD COLUMN dest_latitude REAL;
ALTER TABLE stops ADD COLUMN dest_longitude REAL;

-- All existing stops become points (default handles this).
-- Clear travel_mode since points don't use it.
UPDATE stops SET travel_mode = NULL;
