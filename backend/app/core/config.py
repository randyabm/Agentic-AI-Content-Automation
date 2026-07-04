from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "AI Marketing Platform"
    # "development" | "production". In production the app refuses to boot with
    # placeholder secrets (see validate_production_secrets).
    environment: str = "development"

    database_url: str = "postgresql+psycopg2://marketing:marketing@db:5432/marketing"
    redis_url: str = "redis://redis:6379/0"

    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 120
    refresh_token_expire_days: int = 14

    app_encryption_key: str = "change-me-too"

    admin_email: str = "admin@example.com"
    admin_password: str = "ChangeMe123!"

    anthropic_api_key: str = ""
    openrouter_api_key: str = ""

    # Zernio — social publishing middleman (one app-wide key). Seeded into an
    # encrypted ProviderCredential row on first boot; managed by the platform admin.
    zernio_api_key: str = ""
    zernio_api_url: str = "https://zernio.com/api/v1"
    zernio_webhook_secret: str = ""  # HMAC secret to verify Zernio webhook calls

    # Public base URL the backend is reachable at FROM THE INTERNET. Used to build
    # signed media URLs that Zernio (and the platforms) fetch when publishing.
    # In production set this to the real domain; localhost is not reachable by Zernio.
    public_base_url: str = "http://localhost:8000"

    s3_endpoint_url: str = "http://minio:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "marketing-assets"

    smtp_host: str = "mailpit"
    smtp_port: int = 1025
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "noreply@marketing-platform.local"

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


    @property
    def is_production(self) -> bool:
        return self.environment.lower() in ("production", "prod")


_PLACEHOLDER_SECRETS = {
    "jwt_secret": "change-me",
    "app_encryption_key": "change-me-too",
    "admin_password": "ChangeMe123!",
}


def validate_production_secrets(settings: "Settings") -> None:
    """In production, refuse to start if security-critical secrets were left at
    their placeholder defaults — a forgotten JWT_SECRET lets anyone forge tokens."""
    if not settings.is_production:
        return
    bad = [name for name, placeholder in _PLACEHOLDER_SECRETS.items()
           if getattr(settings, name) == placeholder]
    if settings.cors_origins and any("localhost" in o or "127.0.0.1" in o for o in settings.cors_origins):
        bad.append("cors_origins (still contains localhost)")
    if bad:
        raise RuntimeError(
            "Refusing to start in production with default/placeholder values for: "
            + ", ".join(bad)
            + ". Set these via environment variables."
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
