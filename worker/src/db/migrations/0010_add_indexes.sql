-- ══════════════════════════════════════════════════════════════════════════
-- Migration 0010: Add missing indexes
--
-- Covers the hot query patterns discovered by audit (Task 21):
--   • SELECT * FROM stops WHERE map_id = ? ORDER BY position    → composite
--   • SELECT ... FROM map_shares WHERE map_id = ? ORDER BY created_at
--     (UNIQUE(map_id, user_id) already covers map_id prefix lookups, but not
--      a hot SELECT that only filters on map_id when role-listing shares.)
--
-- Replaces the existing simple idx_stops_map_id with a composite that still
-- supports map_id-prefix scans but also satisfies the ORDER BY without a sort.
-- ══════════════════════════════════════════════════════════════════════════

-- Composite (map_id, position) lets SQLite skip the sort step on the common
-- "all stops for a map, in order" query. The old single-column index is
-- redundant with this prefix, so drop it.
DROP INDEX IF EXISTS idx_stops_map_id;
CREATE INDEX IF NOT EXISTS idx_stops_map_id_position ON stops(map_id, position);

-- map_shares listing queries filter on map_id (GET /:id/shares). While the
-- UNIQUE(map_id, user_id) index already covers this lookup, making it
-- explicit keeps intent visible and guards against future schema shifts.
CREATE INDEX IF NOT EXISTS idx_map_shares_map_id ON map_shares(map_id);
