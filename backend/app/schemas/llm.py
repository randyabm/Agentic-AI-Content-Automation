from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.llm import LLMFunction


class ProviderCredentialUpdate(BaseModel):
    api_key: str | None = None  # plaintext in transit (HTTPS); stored encrypted
    label: str | None = None
    is_active: bool | None = None


class ProviderCredentialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    provider: str
    label: str = ""
    kinds: list[str] = []
    api_key_hint: str = ""  # masked, never the real key
    has_key: bool = False
    is_active: bool = True


class ProviderModelOut(BaseModel):
    id: str
    name: str


class LLMConfigUpdate(BaseModel):
    provider: str | None = None
    model_name: str | None = None
    api_key: str | None = None  # plaintext in transit (HTTPS); stored encrypted
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1, le=64000)
    system_prompt: str | None = None
    is_active: bool | None = None


class LLMConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    function: LLMFunction
    provider: str
    model_name: str
    api_key_hint: str = ""  # masked, never the real key
    temperature: float
    max_tokens: int
    system_prompt: str
    is_active: bool
    updated_at: datetime


class ImageModelCreate(BaseModel):
    display_name: str
    provider: str = "openrouter"
    model_name: str
    api_key: str | None = None
    is_default: bool = False
    is_active: bool = True


class ImageModelUpdate(BaseModel):
    display_name: str | None = None
    provider: str | None = None
    model_name: str | None = None
    api_key: str | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class ImageModelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    display_name: str
    provider: str
    model_name: str
    api_key_hint: str = ""
    is_default: bool
    is_active: bool
    updated_at: datetime


class VideoModelCreate(BaseModel):
    display_name: str
    provider: str = "google_veo"  # google_veo | fal | replicate
    model_name: str
    api_key: str | None = None
    max_duration_seconds: int = Field(8, ge=1, le=60)
    is_default: bool = False
    is_active: bool = True


class VideoModelUpdate(BaseModel):
    display_name: str | None = None
    provider: str | None = None
    model_name: str | None = None
    api_key: str | None = None
    max_duration_seconds: int | None = Field(None, ge=1, le=60)
    is_default: bool | None = None
    is_active: bool | None = None


class VideoModelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    display_name: str
    provider: str
    model_name: str
    api_key_hint: str = ""
    max_duration_seconds: int
    is_default: bool
    is_active: bool
    updated_at: datetime
