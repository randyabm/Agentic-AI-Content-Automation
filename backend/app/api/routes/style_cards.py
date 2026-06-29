"""Style cards CRUD.

Library of design "families" the Visual Agent picks from. Global cards
(is_global=TRUE) are seeded once and visible to every org; admins can add
brand-scoped overrides (brand_id=…) that win for that brand.

Reads are open to any authenticated user (the Visual Agent needs them);
writes are platform-admin only — these cards shape every generated image,
so they're treated as global config.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_platform_admin
from app.db.session import get_db
from app.models.style_card import StyleCard
from app.models.user import User
from app.schemas.style_card import StyleCardCreate, StyleCardOut, StyleCardUpdate
from app.services import audit

router = APIRouter(prefix="/style-cards", tags=["style-cards"])


@router.get("", response_model=list[StyleCardOut])
def list_style_cards(
    family: str | None = None,
    brand_id: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List active style cards. Optional filters by family or brand.

    The Visual Agent calls this with no filters to get the full library.
    Pass `brand_id` to get both global + brand-specific cards for one client.
    """
    stmt = select(StyleCard).where(StyleCard.is_active.is_(True))
    if family:
        stmt = stmt.where(StyleCard.family == family)
    if brand_id is not None:
        stmt = stmt.where((StyleCard.is_global.is_(True)) | (StyleCard.brand_id == brand_id))
    return db.scalars(stmt.order_by(StyleCard.is_global.desc(), StyleCard.family, StyleCard.id)).all()


@router.get("/{card_id}", response_model=StyleCardOut)
def get_style_card(
    card_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    card = db.get(StyleCard, card_id)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Style card not found")
    return card


@router.post("", response_model=StyleCardOut, status_code=status.HTTP_201_CREATED)
def create_style_card(
    body: StyleCardCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_platform_admin),
):
    if db.get(StyleCard, body.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Style card '{body.id}' already exists")
    card = StyleCard(**body.model_dump())
    db.add(card)
    db.commit()
    db.refresh(card)
    audit.record(db, actor, "style_card.create", "style_card", card.id,
                 {"family": card.family, "is_global": card.is_global, "brand_id": card.brand_id})
    return card


@router.patch("/{card_id}", response_model=StyleCardOut)
def update_style_card(
    card_id: str,
    body: StyleCardUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_platform_admin),
):
    card = db.get(StyleCard, card_id)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Style card not found")
    updates = body.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(card, k, v)
    db.commit()
    db.refresh(card)
    audit.record(db, actor, "style_card.update", "style_card", card.id,
                 {"updated_fields": sorted(updates.keys())})
    return card


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_style_card(
    card_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(require_platform_admin),
):
    """Soft-delete (is_active=False) so existing rows in style_history that
    reference the family don't point to a missing card. Use PATCH
    is_active=true to re-enable.
    """
    card = db.get(StyleCard, card_id)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Style card not found")
    card.is_active = False
    db.commit()
    audit.record(db, actor, "style_card.deactivate", "style_card", card.id)
