"""Unified approval state machine.

`Post.approval_status` is the SOURCE OF TRUTH for what may be scheduled and
published. `Campaign.approval_status` is a DERIVED rollup computed by
`sync_campaign_approval()` — do not set it directly anywhere else.

Derivation rules (checked in priority order; post uses the 3-field model —
content_status + approval_status):
  1. any post submitted & pending       → pending_review  (a review is open)
  2. ≥1 post and ALL approved/not_required → approved      (everything may publish)
  3. any post rejected / changes_requested → changes_requested (edits needed)
  4. otherwise                          → draft

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

from app.models.campaign import ApprovalStatus, Campaign, CampaignApprovalStatus, ContentStatus, Post

# Post approval states that count as "cleared to publish" for the campaign rollup.
_CLEARED = (ApprovalStatus.approved, ApprovalStatus.not_required)


def campaign_posts(db: Session, campaign: Campaign) -> list[Post]:
    return list(db.scalars(select(Post).where(Post.campaign_id == campaign.id)))


def derive_campaign_status(posts: list[Post]) -> CampaignApprovalStatus:
    """Roll the per-post 3-field state up to the (unchanged) 5-value campaign
    status. A post is "in review" when it's been submitted (content
    ready_for_review) and the gate is still pending."""
    in_review = any(
        p.approval_status == ApprovalStatus.pending
        and p.content_status == ContentStatus.ready_for_review
        for p in posts
    )
    if in_review:
        return CampaignApprovalStatus.pending_review
    if posts and all(p.approval_status in _CLEARED for p in posts):
        return CampaignApprovalStatus.approved
    if any(
        p.approval_status == ApprovalStatus.rejected
        or p.content_status == ContentStatus.changes_requested
        for p in posts
    ):
        return CampaignApprovalStatus.changes_requested
    return CampaignApprovalStatus.draft


def void_approval_on_edit(post: Post) -> bool:
    """FR-08/09: a material edit to an APPROVED post voids its approval and
    sends it back for re-review (content ready_for_review, gate pending). Does
    not touch not_required posts (their brand opted out of review) or posts
    still in draft/pending/rejected. Returns True if approval was voided.

    Caller must sync_campaign_approval + commit."""
    if post.approval_status == ApprovalStatus.approved:
        post.approval_status = ApprovalStatus.pending
        post.content_status = ContentStatus.ready_for_review
        post.reviewed_by = None
        post.reviewed_at = None
        return True
    return False


def sync_campaign_approval(db: Session, campaign: Campaign, posts: list[Post] | None = None) -> None:
    """Recompute campaign.approval_status from its posts. Does NOT commit —
    the caller owns the transaction."""
    if posts is None:
        posts = campaign_posts(db, campaign)
    campaign.approval_status = derive_campaign_status(posts)
