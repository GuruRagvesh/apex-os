-- Asset tickets may request one or several items while retaining the legacy
-- requestedAssetType column for already-imported and single-item records.
ALTER TABLE "asset_requests" ADD COLUMN "requestedItems" JSONB;
