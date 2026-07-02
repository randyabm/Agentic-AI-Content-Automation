"""Unified approval state machine.

`Post.approval_status` is the SOURCE OF TRUTH for what may be scheduled and
published. `Campaign.approval_status` is a DERIVED rollup computed by
`sync_campaign_approval()` — do not set it directly anywhere else.

Derivation rules (checked in priority order):
  1. any post pending_review          → pending_review  (a review is open)
  2. ≥1 post and ALL approved         → approved        (everything may publish)
  3. any post rejected                → changes_requested (edits needed)
  4. otherwise                        → draft

Two campaign-level actions override the rollup AFTER syncing their posts,
because the rollup can't distinguish them from post-level outcomes:
  - reject_campaign        → campaign shows `rejected` (posts were rejected too)
  - request_campaign_changes → campaign shows `changes_requested` with the
    reviewer's note while its posts return to `draft` for editing.

History: before this module existed there were two independent approval
workflows writing the same fields — campaign approval didn't touch posts
(migration 018 repaired the fallout) and later stomped individually-rejected
posts back to approved. Keeping the rollup in one function prevents both.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.campaign import ApprovalStatus, Campaign, CampaignApprovalStatus, Post


def campaign_posts(db: Session, campaign: Campaign) -> list[Post]:
    return list(db.scalars(select(Post).where(Post.campaign_id == campaign.id)))


def derive_campaign_status(posts: list[Post]) -> CampaignApprovalStatus:
    statuses = [p.approval_status for p in posts]
    if any(s == ApprovalStatus.pending_review for s in statuses):
        return CampaignApprovalStatus.pending_review
    if statuses and all(s == ApprovalStatus.approved for s in statuses):
        return CampaignApprovalStatus.approved
    if any(s == ApprovalStatus.rejected for s in statuses):
        return CampaignApprovalStatus.changes_requested
    return CampaignApprovalStatus.draft


def sync_campaign_approval(db: Session, campaign: Campaign, posts: list[Post] | None = None) -> None:
    """Recompute campaign.approval_status from its posts. Does NOT commit —
    the caller owns the transaction."""
    if posts is None:
        posts = campaign_posts(db, campaign)
    campaign.approval_status = derive_campaign_status(posts)
