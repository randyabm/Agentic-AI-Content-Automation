-- Migration 018: backfill post-level approval on already-approved campaigns.
-- Before this fix, approve_campaign only flipped campaign.approval_status
-- without approving each Post row, leaving posts stuck in draft/pending_review
-- even though the campaign showed "Approved" — blocking publish (which
-- requires post.approval_status = 'approved') for campaigns approved before
-- this fix shipped. One-time, idempotent (WHERE excludes already-approved rows).

UPDATE posts
SET approval_status = 'approved',
    reviewed_at = COALESCE(posts.reviewed_at, now())
FROM campaigns
WHERE posts.campaign_id = campaigns.id
  AND campaigns.approval_status = 'approved'
  AND posts.approval_status <> 'approved';
