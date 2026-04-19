-- ══════════════════════════════════════════════════════════════════════════
-- Migration 0013: Backfill maps.export_settings NULLs (Task 30)
--
-- The column was added in 0007 with `DEFAULT '{}'` but remained NULLable.
-- Older rows written before that default took effect (or through code paths
-- that explicitly INSERTed NULL) can carry NULL, which the Worker's map
-- duplication logic and the frontend JSON.parse both stumble on.
--
-- Backfill any existing NULLs to '{}' so the follow-on CHECK-constraint
-- migration (0014) can safely promote the column to NOT NULL.
-- ══════════════════════════════════════════════════════════════════════════

UPDATE maps SET export_settings = '{}' WHERE export_settings IS NULL;
