-- ══════════════════════════════════════════════════════════════════════════
-- Migration 0003: Index on map_shares(user_id)
-- Speeds up lookups of all shares for a given user (e.g. list maps endpoint).
-- ══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_map_shares_user_id ON map_shares(user_id);
