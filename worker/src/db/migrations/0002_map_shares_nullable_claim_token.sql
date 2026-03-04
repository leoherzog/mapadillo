-- ══════════════════════════════════════════════════════════════════════════
-- Migration 0002: Make claim_token nullable in map_shares
-- Allows nullifying the token after a share has been claimed (Item 9).
-- SQLite does not support ALTER COLUMN directly; recreate the table.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS map_shares_new (
  id TEXT PRIMARY KEY NOT NULL,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES "user"(id),
  role TEXT NOT NULL DEFAULT 'viewer',
  claim_token TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(map_id, user_id)
);

INSERT INTO map_shares_new SELECT * FROM map_shares;

DROP TABLE map_shares;

ALTER TABLE map_shares_new RENAME TO map_shares;
