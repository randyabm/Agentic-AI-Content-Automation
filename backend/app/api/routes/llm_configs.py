from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.core.crypto import decrypt_secret, encrypt_secret, mask_secret
from app.db.session import get_db
from app.models.llm import ImageModel, LLMConfig
from app.models.user import User
from app.schemas.llm import (
    ImageModelCreate,
    ImageModelOut,
    ImageModelUpdate,
    LLMConfigOut,
    LLMConfigUpdate,
)
from app.services import audit

router = APIRouter(tags=["llm-config"])


def _config_out(cfg: LLMConfig) -> LLMConfigOut:
    out = LLMConfigOut.model_validate(cfg)
    out.api_key_hint = mask_secret(decrypt_secret(cfg.api_key_encrypted))
    return out


def _image_model_out(m: ImageModel) -> ImageModelOut:
    out = ImageModelOut.model_validate(m)
    out.api_key_hint = mask_secret(decrypt_secret(m.api_key_encrypted))
    return out


@router.get("/llm-configs", response_model=list[LLMConfigOut])
def list_llm_configs(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return [_config_out(c) for c in db.scalars(select(LLMConfig).order_by(LLMConfig.function)).all()]


@router.patch("/llm-configs/{config_id}", response_model=LLMConfigOut)
def update_llm_config(
    config_id: str,
    body: LLMConfigUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
):
    cfg = db.get(LLMConfig, config_id)
    if cfg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "LLM config not found")
    changes = body.model_dump(exclude_unset=True)
    if "api_key" in changes:
        cfg.api_key_encrypted = encrypt_secret(changes.pop("api_key") or "")
    for field, value in changes.items():
        setattr(cfg, field, value)
    db.commit()
    audit.record(db, actor, "llm_config.update", "llm_config", cfg.id, {"function": cfg.function.value})
    return _config_out(cfg)


@router.get("/image-models", response_model=list[ImageModelOut])
def list_image_models(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """All authenticated users can list image models (users pick one at generation time).

    Only active models are returned to non-admins.
    """
    query = select(ImageModel).order_by(ImageModel.display_name)
    models = db.scalars(query).all()
    if user.role.value != "admin":
        models = [m for m in models if m.is_active]
    return [_image_model_out(m) for m in models]


@router.post("/image-models", response_model=ImageModelOut, status_code=status.HTTP_201_CREATED)
def create_image_model(body: ImageModelCreate, db: Session = Depends(get_db), actor: User = Depends(require_admin)):
    model = ImageModel(
        display_name=body.display_name,
        provider=body.provider,
        model_name=body.model_name,
        api_key_encrypted=encrypt_secret(body.api_key or ""),
        is_default=body.is_default,
        is_active=body.is_active,
    )
    if body.is_default:
        _clear_other_defaults(db, exclude_id=None)
    db.add(model)
    db.commit()
    audit.record(db, actor, "image_model.create", "image_model", model.id, {"model": body.model_name})
    return _image_model_out(model)


@router.patch("/image-models/{model_id}", response_model=ImageModelOut)
def update_image_model(
    model_id: str,
    body: ImageModelUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
):
    model = db.get(ImageModel, model_id)
    if model is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image model not found")
    changes = body.model_dump(exclude_unset=True)
    if "api_key" in changes:
        model.api_key_encrypted = encrypt_secret(changes.pop("api_key") or "")
    if changes.get("is_default"):
        _clear_other_defaults(db, exclude_id=model.id)
    for field, value in changes.items():
        setattr(model, field, value)
    db.commit()
    audit.record(db, actor, "image_model.update", "image_model", model.id)
    return _image_model_out(model)


@router.delete("/image-models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_image_model(model_id: str, db: Session = Depends(get_db), actor: User = Depends(require_admin)):
    model = db.get(ImageModel, model_id)
    if model is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image model not found")
    db.delete(model)
    db.commit()
    audit.record(db, actor, "image_model.delete", "image_model", model_id)


def _clear_other_defaults(db: Session, exclude_id: str | None) -> None:
    for m in db.scalars(select(ImageModel).where(ImageModel.is_default)).all():
        if m.id != exclude_id:
            m.is_default = False
