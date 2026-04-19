-- ══════════════════════════════════════════════════════════════════════════
-- Migration 0013: CHECK constraints on enum TEXT columns (Task 22)
--
-- Previously, every enum-style TEXT column was validated only at the app
-- layer. Any INSERT/UPDATE that bypassed the Hono routes (direct D1 REST
-- API, a future Worker, an admin SQL console, migrations) could silently
-- persist garbage. Moving the invariant into SQL hardens the DB as the
-- source of truth.
--
-- Columns gaining CHECK:
--   user.units              in ('km', 'mi')
--   maps.visibility         in ('public', 'private')
--   stops.type              in ('point', 'route')
--   stops.travel_mode       in ('drive', 'walk', 'bike', 'plane', 'boat')  (NULL allowed)
--   map_shares.role         in ('viewer', 'editor')
--   orders.status           in ('pending_payment', 'paid', 'pending_render',
--                                'submitted', 'in_production', 'shipped',
--                                'completed', 'cancelled', 'failed')
--
-- SQLite cannot add a CHECK to an existing column. Standard table-recreate
-- pattern: build _new with the constraint, copy rows, drop old, rename.
-- ══════════════════════════════════════════════════════════════════════════

-- ── user ───────────────────────────────────────────────────────────────────
CREATE TABLE "user_new" (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  units TEXT NOT NULL DEFAULT 'km' CHECK (units IN ('km', 'mi'))
);
INSERT INTO "user_new" (id, name, email, emailVerified, image, createdAt, updatedAt, units)
  SELECT id, name, email, emailVerified, image, createdAt, updatedAt, units FROM "user";
DROP TABLE "user";
ALTER TABLE "user_new" RENAME TO "user";

-- ── maps ───────────────────────────────────────────────────────────────────
CREATE TABLE maps_new (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  family_name TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  export_settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO maps_new (id, owner_id, name, family_name, visibility, export_settings, created_at, updated_at)
  SELECT id, owner_id, name, family_name, visibility, COALESCE(export_settings, '{}'), created_at, updated_at FROM maps;
DROP TABLE maps;
ALTER TABLE maps_new RENAME TO maps;
CREATE INDEX IF NOT EXISTS idx_maps_owner_id ON maps(owner_id);

-- ── stops ──────────────────────────────────────────────────────────────────
-- Also picks up the DROP of show_start_label/show_dest_label from 0012 by
-- virtue of not including them, but those are already gone by this point.
CREATE TABLE stops_new (
  id TEXT PRIMARY KEY NOT NULL,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  label TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  icon TEXT,
  travel_mode TEXT CHECK (travel_mode IS NULL OR travel_mode IN ('drive', 'walk', 'bike', 'plane', 'boat')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL DEFAULT 'point' CHECK (type IN ('point', 'route')),
  dest_name TEXT,
  dest_latitude REAL,
  dest_longitude REAL,
  dest_icon TEXT,
  route_geometry TEXT
);
INSERT INTO stops_new (id, map_id, position, name, label, latitude, longitude, icon, travel_mode, created_at, type, dest_name, dest_latitude, dest_longitude, dest_icon, route_geometry)
  SELECT id, map_id, position, name, label, latitude, longitude, icon, travel_mode, created_at, type, dest_name, dest_latitude, dest_longitude, dest_icon, route_geometry FROM stops;
DROP TABLE stops;
ALTER TABLE stops_new RENAME TO stops;
CREATE INDEX IF NOT EXISTS idx_stops_map_id_position ON stops(map_id, position);

-- ── map_shares ─────────────────────────────────────────────────────────────
CREATE TABLE map_shares_new (
  id TEXT PRIMARY KEY NOT NULL,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES "user"(id),
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  claim_token TEXT UNIQUE,
  claim_token_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(map_id, user_id)
);
INSERT INTO map_shares_new (id, map_id, user_id, role, claim_token, claim_token_expires_at, created_at)
  SELECT id, map_id, user_id, role, claim_token, claim_token_expires_at, created_at FROM map_shares;
DROP TABLE map_shares;
ALTER TABLE map_shares_new RENAME TO map_shares;
CREATE INDEX IF NOT EXISTS idx_map_shares_user_id ON map_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_map_shares_map_id ON map_shares(map_id);

-- ── orders ─────────────────────────────────────────────────────────────────
CREATE TABLE orders_new (
  id TEXT PRIMARY KEY NOT NULL,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  product_type TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  poster_size TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
    'pending_payment', 'paid', 'pending_render', 'submitted',
    'in_production', 'shipped', 'completed', 'cancelled', 'failed'
  )),
  stripe_session_id TEXT UNIQUE,
  prodigi_order_id TEXT,
  image_url TEXT,
  shipping_address TEXT,
  subtotal INTEGER,
  shipping_cost INTEGER,
  currency TEXT NOT NULL DEFAULT 'usd',
  tracking_url TEXT,
  discord_notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO orders_new SELECT * FROM orders;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_map_id ON orders(map_id);
