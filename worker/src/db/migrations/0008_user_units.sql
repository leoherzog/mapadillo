-- Add units preference to user table (per-account setting)
ALTER TABLE "user" ADD COLUMN units TEXT NOT NULL DEFAULT 'km';
