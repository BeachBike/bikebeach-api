-- 2026-05 — Pix charges that pass their due date without being paid get
-- the dedicated EXPIRED status (the QR code is no longer scannable). Set
-- by the reconciliation cron + the on-demand Asaas sync.
ALTER TYPE "PaymentStatus" ADD VALUE 'EXPIRED';
