-- Initial D1 schema: Better Auth core and passkey tables plus the application tables.
-- Enum-style TEXT columns carry CHECK constraints so writes that bypass the Hono routes stay valid.

-- ── Better Auth core tables ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  units TEXT CHECK (units IN ('km', 'mi'))
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

CREATE INDEX IF NOT EXISTS idx_session_user_id ON "session"(userId);
CREATE INDEX IF NOT EXISTS idx_account_user_id ON "account"(userId);
CREATE INDEX IF NOT EXISTS idx_verification_identifier ON "verification"(identifier);
CREATE INDEX IF NOT EXISTS idx_passkey_user_id ON "passkey"(userId);

-- ── Application tables ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  family_name TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  export_settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_maps_owner_id ON maps(owner_id);

CREATE TABLE IF NOT EXISTS stops (
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

-- Serves "all stops for a map, in order" without a sort step.
CREATE INDEX IF NOT EXISTS idx_stops_map_id_position ON stops(map_id, position);

-- SQLite treats NULLs as distinct in UNIQUE, so a map can hold many unclaimed
-- invites (user_id NULL). A claimed share keeps its claim_token so its claimant
-- can reopen the link; GET /api/maps/:id/shares hides it.
CREATE TABLE IF NOT EXISTS map_shares (
  id TEXT PRIMARY KEY NOT NULL,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES "user"(id),
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  claim_token TEXT UNIQUE,
  claim_token_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(map_id, user_id)
);

-- No map_id index: UNIQUE(map_id, user_id) serves map_id lookups.
CREATE INDEX IF NOT EXISTS idx_map_shares_user_id ON map_shares(user_id);

-- Orders are financial records and must not be deleted when a map or user is removed.
CREATE TABLE IF NOT EXISTS orders (
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
  customer_email TEXT,
  discord_notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_map_id ON orders(map_id);
CREATE INDEX IF NOT EXISTS idx_orders_prodigi_order_id ON orders(prodigi_order_id);
