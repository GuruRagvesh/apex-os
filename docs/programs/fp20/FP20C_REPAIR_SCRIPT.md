# FP20C_REPAIR_SCRIPT

The Node.js script `backend/tva_repair.js` was generated to process these anomalies safely.
It enforces `DRY_RUN=true` by default unless `EXECUTE_REPAIR=true` is passed as an environment variable.

It targets exclusively:
- WS_03 / WS_04
- BL_01
- BL_04

All other categories are exported for manual review or excluded.
