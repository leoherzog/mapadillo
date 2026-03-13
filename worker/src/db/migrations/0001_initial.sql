-- TODO(M9): Implement short-lived signed cookie cache to avoid stale D1 reads
-- after writes (eventual consistency mitigation). See PLAN.md "Session management".

-- ══════════════════════════════════════════════════════════════════════════
-- Migration 0001: Initial schema
-- Better Auth tables + Passkey plugin table + application tables
-- ══════════════════════════════════════════════════════════════════════════

-- ── Better Auth core tables ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
  id TEXT PRIMARY KEY NOT NULL,
  expiresAt INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
  id TEXT PRIMARY KEY NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification" (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER,
  updatedAt INTEGER
);

-- ── Better Auth passkey plugin table ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS "passkey" (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  publicKey TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  counter INTEGER NOT NULL DEFAULT 0,
  deviceType TEXT,
  backedUp INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  credentialID TEXT NOT NULL UNIQUE,
  createdAt INTEGER,
  aaguid TEXT
);

-- ── Application tables ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  family_name TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  style_preferences TEXT DEFAULT '{}',
  units TEXT NOT NULL DEFAULT 'km',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stops (
  id TEXT PRIMARY KEY NOT NULL,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  label TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  icon TEXT,
  travel_mode TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stops_map_id ON stops(map_id);
CREATE INDEX IF NOT EXISTS idx_maps_owner_id ON maps(owner_id);

CREATE TABLE IF NOT EXISTS map_shares (
  id TEXT PRIMARY KEY NOT NULL,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES "user"(id),
  role TEXT NOT NULL DEFAULT 'viewer',
  claim_token TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Note: SQLite treats NULL as distinct for UNIQUE constraints, so multiple
  -- unclaimed shares (user_id = NULL) for the same map_id are allowed.
  UNIQUE(map_id, user_id)
);

-- Orders are financial records and must not be deleted when a map or user is removed.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY NOT NULL,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  product_type TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  poster_size TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment',
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

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_map_id ON orders(map_id);
