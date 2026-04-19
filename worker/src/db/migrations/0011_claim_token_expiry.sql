-- ══════════════════════════════════════════════════════════════════════════
-- Migration 0011: Add expiry to map_shares.claim_token (Task 12)
--
-- Claim tokens previously lived forever until consumed. A long-lived,
-- guessable-by-URL invite is a security/operational risk: leaked tokens from
-- email, chat history, browser history, etc. never auto-expire.
--
-- Adds claim_token_expires_at (ISO timestamp). NULL = no expiry (legacy
-- rows). New invites are issued with a 30-day expiry (enforced in the app
-- layer so the default window is easy to tune without a DB migration).
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE map_shares ADD COLUMN claim_token_expires_at TEXT;
