INSERT INTO "asset_types" ("id", "name", "isActive", "createdAt", "updatedAt")
VALUES
  ('default-asset-type-laptop', 'LAPTOP', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('default-asset-type-mouse', 'MOUSE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('default-asset-type-monitor', 'MONITOR', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('default-asset-type-keyboard', 'KEYBOARD', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('default-asset-type-mobile', 'MOBILE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('default-asset-type-headphones', 'HEADPHONES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('default-asset-type-connectors', 'CONNECTORS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('default-asset-type-hard-drive', 'HARD DRIVE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('default-asset-type-desktop', 'DESKTOP', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE
SET "isActive" = true, "updatedAt" = CURRENT_TIMESTAMP;
