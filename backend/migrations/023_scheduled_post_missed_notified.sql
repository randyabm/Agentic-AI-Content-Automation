-- Migration 023: track when a past-due-without-approval scheduled post has been
-- reported, so the missed-approval sweep notifies the creator/approver once
-- instead of every beat tick.
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS missed_notified_at TIMESTAMPTZ;
