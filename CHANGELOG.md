# Changelog

## 1.0.0 — 2026-10-25
First release.
- POS screen with barcode wedge scanning, modifiers, variants, units, weighed and open-price items, hold/recall/split/merge, hotkeys and command palette
- Payments: cash with change, PromptPay EMVCo QR, transfer, card, split tender, store credit, points; offline sale queue with idempotent sync
- Thai VAT (inclusive/exclusive), service charge, rounding, abbreviated and full tax invoices, output VAT report
- Receipt designer; ESC/POS LAN printing with Thai bitmap rendering, kitchen/bar routing, offline print queue, cash drawer; Windows system printers in the desktop app
- Products with custom fields, price tiers, bundles, Excel/CSV import with validation, bulk edit, barcode labels
- Stock ledger with moving-average cost, receive/adjust/count/transfer, lots and expiry
- Members, groups, tiers, points, credit; promotions (percent, amount, buy X get Y, threshold, fixed price, coupons, schedules, priority)
- Restaurant mode: floor plan, kitchen rounds, KDS, staff order app (PWA), customer display
- Shifts with X/Z reports; dashboard and reports with Excel/CSV/PDF export
- Roles with permission matrix, manager PIN approval, audit log, auto-lock
- SQLite / PostgreSQL / MySQL from one codebase; LAN host discovery; automatic portable backups; offline Ed25519 licensing
- Windows installer (Electron) and Docker image
