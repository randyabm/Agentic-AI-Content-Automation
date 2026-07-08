"""Unauthenticated external approval endpoints (Phase 2 public approval links).

A signed token grants preview + Approve / Request Changes on ONE campaign — no
account, no edit, no publish. Reuses the same approval state machine as the
authenticated routes.
"""
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.campaign import ApprovalStatus, Campaign, CampaignApprovalStatus, ContentStatus, Post
from app.models.client import Client
from app.services import approval, approval_links, audit, notifications

router = APIRouter(tags=["public-approval"])


class PublicPostView(BaseModel):
    platform: str
    headline: str
    copy: str
    cta: str
    hashtags: list


class PublicApprovalView(BaseModel):
    campaign_name: str
    client_name: str
    approval_status: str
    approval_message: str
    can_act: bool  # only pending_review campaigns can be approved/changed
    posts: list[PublicPostView]


class PublicReject(BaseModel):
    note: str = ""


def _load(token: str, db: Session) -> Campaign:
    try:
        campaign_id = approval_links.verify_approval_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_410_GONE, "This approval link has expired.")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invalid approval link.")
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found.")
    return campaign


@router.get("/public/approval/{token}", response_model=PublicApprovalView)
def public_preview(token: str, db: Session = Depends(get_db)):
    campaign = _load(token, db)
    client = db.get(Client, campaign.client_id)
    posts = approval.campaign_posts(db, campaign)
    return PublicApprovalView(
        campaign_name=campaign.name,
        client_name=client.company_name if client else "",
        approval_status=campaign.approval_status.value,
        approval_message=campaign.approval_message or "",
        can_act=campaign.approval_status == CampaignApprovalStatus.pending_review,
        posts=[
            PublicPostView(
                platform=p.platform.value, headline=p.headline or "",
                copy=p.copy or "", cta=p.cta or "", hashtags=p.hashtags or [],
            )
            for p in sorted(posts, key=lambda x: (x.platform.value, x.position))
        ],
    )


@router.post("/public/approval/{token}/approve", response_model=PublicApprovalView)
def public_approve(token: str, db: Session = Depends(get_db)):
    campaign = _load(token, db)
    if campaign.approval_status != CampaignApprovalStatus.pending_review:
        raise HTTPException(status.HTTP_409_CONFLICT, "This campaign is not awaiting approval.")
    now = datetime.now(timezone.utc)
    posts = approval.campaign_posts(db, campaign)
    for p in posts:
        if p.approval_status == ApprovalStatus.pending:
            p.approval_status = ApprovalStatus.approved
            p.reviewed_at = now
    approval.sync_campaign_approval(db, campaign, posts)
    campaign.reviewed_at = now
    if campaign.created_by:
        notifications.notify(
            db, user_id=campaign.created_by, type="approved",
            title=f"Approved by client: {campaign.name}",
            body="Your client approved this campaign via the shared link.",
            entity_type="campaign", entity_id=campaign.id,
            link=f"/campaigns/{campaign.id}", send_email=True,
        )
    db.commit()
    audit.record(db, None, "campaign.approve.external", "campaign", campaign.id, {"via": "public_link"})
    return public_preview(token, db)


@router.post("/public/approval/{token}/request-changes", response_model=PublicApprovalView)
def public_request_changes(token: str, body: PublicReject, db: Session = Depends(get_db)):
    campaign = _load(token, db)
    if campaign.approval_status != CampaignApprovalStatus.pending_review:
        raise HTTPException(status.HTTP_409_CONFLICT, "This campaign is not awaiting approval.")
    if not body.note.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A comment is required when requesting changes.")
    now = datetime.now(timezone.utc)
    posts = approval.campaign_posts(db, campaign)
    for p in posts:
        if p.approval_status == ApprovalStatus.pending and p.content_status == ContentStatus.ready_for_review:
            p.content_status = ContentStatus.changes_requested
            p.reviewed_at = now
            p.review_note = body.note
            p.rejection_comment = body.note
    approval.sync_campaign_approval(db, campaign, posts)
    campaign.approval_status = CampaignApprovalStatus.changes_requested
    campaign.review_note = body.note
    campaign.reviewed_at = now
    if campaign.created_by:
        notifications.notify(
            db, user_id=campaign.created_by, type="changes_requested",
            title=f"Client requested changes: {campaign.name}",
            body=body.note, entity_type="campaign", entity_id=campaign.id,
            link=f"/campaigns/{campaign.id}", send_email=True,
        )
    db.commit()
    audit.record(db, None, "campaign.request_changes.external", "campaign", campaign.id, {"via": "public_link"})
    return public_preview(token, db)
