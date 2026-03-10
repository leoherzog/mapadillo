-- Add export_settings column to persist export preferences + map viewport
ALTER TABLE maps ADD COLUMN export_settings TEXT DEFAULT '{}';
