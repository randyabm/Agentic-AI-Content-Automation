-- Planning-only scheduling: allow a ScheduledPost without a connected channel.
-- An approved or draft post can be placed on the calendar (status 'scheduled')
-- even when its client has no connected channel yet. Such a post is a plan — the
-- due sweep skips it (never auto-publishes) until it's approved and a channel is
-- connected. The UI keeps showing the "Not approved yet" / "no channel" notice.

ALTER TABLE scheduled_posts
  ALTER COLUMN social_account_id DROP NOT NULL;
