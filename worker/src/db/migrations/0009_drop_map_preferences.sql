-- Remove per-map units and style_preferences (now per-user-account)
ALTER TABLE maps DROP COLUMN style_preferences;
ALTER TABLE maps DROP COLUMN units;
