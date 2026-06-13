from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.core.crypto import decrypt_secret, encrypt_secret, mask_secret
from app.db.session import get_db
from app.models.llm import ImageModel, LLMConfig, ProviderCredential, VideoModel
from app.models.user import User
from app.schemas.llm import (
    ImageModelCreate,
    ImageModelOut,
    ImageModelUpdate,
    LLMConfigOut,
    LLMConfigUpdate,
    ProviderCredentialOut,
    ProviderCredentialUpdate,
    ProviderModelOut,
    VideoModelCreate,
    VideoModelOut,
    VideoModelUpdate,
)
from app.services import audit, providers

router = APIRouter(tags=["llm-config"])


# --- Provider credentials (one key per provider, shared everywhere) ----------


@router.get("/provider-credentials", response_model=list[ProviderCredentialOut])
def list_provider_credentials(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    existing = {c.provider: c for c in db.scalars(select(ProviderCredential)).all()}
    out: list[ProviderCredentialOut] = []
    for info in providers.CANONICAL_PROVIDERS:
        cred = existing.get(info.key)
        key = decrypt_secret(cred.api_key_encrypted) if cred else ""
        out.append(
            ProviderCredentialOut(
                provider=info.key,
                label=(cred.label if cred else "") or info.label,
                kinds=list(info.kinds),
                api_key_hint=mask_secret(key),
                has_key=bool(key),
                is_active=cred.is_active if cred else True,
            )
        )
    return out


@router.put("/provider-credentials/{provider}", response_model=ProviderCredentialOut)
def upsert_provider_credential(
    provider: str,
    body: ProviderCredentialUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
):
    info = next((p for p in providers.CANONICAL_PROVIDERS if p.key == provider), None)
    if info is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown provider '{provider}'")
    cred = db.scalar(select(ProviderCredential).where(ProviderCredential.provider == provider))
    if cred is None:
        cred = ProviderCredential(provider=provider, label=info.label)
        db.add(cred)
    changes = body.model_dump(exclude_unset=True)
    if "api_key" in changes:
        cred.api_key_encrypted = encrypt_secret(changes.pop("api_key") or "")
    for field, value in changes.items():
        setattr(cred, field, value)
    db.commit()
    audit.record(db, actor, "provider_credential.update", "provider_credential", cred.id, {"provider": provider})
    key = decrypt_secret(cred.api_key_encrypted)
    return ProviderCredentialOut(
        provider=info.key,
        label=cred.label or info.label,
        kinds=list(info.kinds),
        api_key_hint=mask_secret(key),
        has_key=bool(key),
        is_active=cred.is_active,
    )


@router.get("/providers/{provider}/models", response_model=list[ProviderModelOut])
def list_provider_models(
    provider: str,
    kind: str = "text",
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Auto-fetch the available model IDs for a provider so the admin picks from a

    dropdown instead of typing the model ID by hand. Empty list => UI falls back
    to manual entry (e.g. fal/replicate, or when the provider's API rejects the key).
    """
    api_key = providers.resolve_api_key(db, provider)
    if not api_key:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"No API key set for '{providers.credential_provider(provider)}'. Add it under Providers & Keys first.",
        )
    try:
        return providers.list_models(provider, kind, api_key)
    except providers.ProviderModelsError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


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


# --- Video models (same admin-curated pattern as image models) ---


def _video_model_out(m: VideoModel) -> VideoModelOut:
    out = VideoModelOut.model_validate(m)
    out.api_key_hint = mask_secret(decrypt_secret(m.api_key_encrypted))
    return out


@router.get("/video-models", response_model=list[VideoModelOut])
def list_video_models(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """All authenticated users can list video models; non-admins only see active ones."""
    models = db.scalars(select(VideoModel).order_by(VideoModel.display_name)).all()
    if user.role.value != "admin":
        models = [m for m in models if m.is_active]
    return [_video_model_out(m) for m in models]


@router.post("/video-models", response_model=VideoModelOut, status_code=status.HTTP_201_CREATED)
def create_video_model(body: VideoModelCreate, db: Session = Depends(get_db), actor: User = Depends(require_admin)):
    model = VideoModel(
        display_name=body.display_name,
        provider=body.provider,
        model_name=body.model_name,
        api_key_encrypted=encrypt_secret(body.api_key or ""),
        max_duration_seconds=body.max_duration_seconds,
        is_default=body.is_default,
        is_active=body.is_active,
    )
    if body.is_default:
        _clear_other_video_defaults(db, exclude_id=None)
    db.add(model)
    db.commit()
    audit.record(db, actor, "video_model.create", "video_model", model.id, {"model": body.model_name})
    return _video_model_out(model)


@router.patch("/video-models/{model_id}", response_model=VideoModelOut)
def update_video_model(
    model_id: str,
    body: VideoModelUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
):
    model = db.get(VideoModel, model_id)
    if model is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video model not found")
    changes = body.model_dump(exclude_unset=True)
    if "api_key" in changes:
        model.api_key_encrypted = encrypt_secret(changes.pop("api_key") or "")
    if changes.get("is_default"):
        _clear_other_video_defaults(db, exclude_id=model.id)
    for field, value in changes.items():
        setattr(model, field, value)
    db.commit()
    audit.record(db, actor, "video_model.update", "video_model", model.id)
    return _video_model_out(model)


@router.delete("/video-models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_video_model(model_id: str, db: Session = Depends(get_db), actor: User = Depends(require_admin)):
    model = db.get(VideoModel, model_id)
    if model is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video model not found")
    db.delete(model)
    db.commit()
    audit.record(db, actor, "video_model.delete", "video_model", model_id)


def _clear_other_video_defaults(db: Session, exclude_id: str | None) -> None:
    for m in db.scalars(select(VideoModel).where(VideoModel.is_default)).all():
        if m.id != exclude_id:
            m.is_default = False
