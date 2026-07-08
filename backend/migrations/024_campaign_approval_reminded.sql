-- Migration 024: track when an "approval overdue" reminder was sent for a
-- campaign so the deadline sweep reminds once instead of every tick.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approval_reminded_at TIMESTAMPTZ;
