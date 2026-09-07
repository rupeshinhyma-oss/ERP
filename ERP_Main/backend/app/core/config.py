"""
ERP_Main Configuration.

All runtime configuration is centralized here, following the same pattern
as Yinglima_ERP's `app.core.config`: one `Settings` object, sourced from
environment variables (with a local `.env` for development), and nothing
else in the codebase reads `os.environ` directly.

Scope note (Phase 2 -> Phase 3)
--------------------------------
Phase 2 shipped the ERP Registry only, with no authentication at all.
Phase 3 adds the control plane's first two security principals:
- Platform administrators (humans) -- `PLATFORM_JWT_SECRET_KEY` etc. below.
- ERP services (machines) -- service-credential hashing lives in
  `app.service_identity.security`, reusing `PLATFORM_JWT_SECRET_KEY`'s
  sibling constant only where noted; the credential SECRET itself is
  never stored, only its hash (see that module).
Every secret-shaped field below follows Yinglima's own convention: a
clearly-fake `CHANGE-ME-IN-PRODUCTION` default so local dev works with
zero setup, paired with `validate_production_secrets()` refusing to boot
in production with that default still in place.
"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class EnvironmentEnum(str, Enum):
    """Supported deployment environments (mirrors Yinglima_ERP's enum)."""

    LOCAL = "local"
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"
    TEST = "test"


class Settings(BaseSettings):
    """
    Strongly-typed ERP_Main settings, populated from environment variables
    and/or a `.env` file at the project root.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # -------------------------------------------------------------------
    # Application metadata
    # -------------------------------------------------------------------
    APP_NAME: str = "ERP_Main - Global Control Plane"
    APP_VERSION: str = "0.1.0"
    ENVIRONMENT: EnvironmentEnum = EnvironmentEnum.LOCAL
    DEBUG: bool = False

    # -------------------------------------------------------------------
    # API
    # -------------------------------------------------------------------
    API_V1_PREFIX: str = "/api/v1"
    DOCS_URL: str | None = "/docs"
    REDOC_URL: str | None = "/redoc"
    OPENAPI_URL: str | None = "/openapi.json"

    # -------------------------------------------------------------------
    # Server & Service URLs
    # -------------------------------------------------------------------
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    BACKEND_URL: str = "http://localhost:8000"
    FRONTEND_URL: str = "http://localhost:5170"

    # -------------------------------------------------------------------
    # Database
    #
    # ERP_Main owns its own database, entirely separate from Yinglima's
    # (or any other ERP's) database. Defaults to a local SQLite file so
    # the service is runnable/testable with zero external infrastructure;
    # production deployments must supply a real DATABASE_URL (Postgres),
    # exactly as Yinglima does.
    # -------------------------------------------------------------------
    DATABASE_URL: str = "sqlite+aiosqlite:///./erp_main.db"
    DATABASE_ECHO: bool = False

    # -------------------------------------------------------------------
    # CORS
    #
    # Step 53 of the Phase 3 brief: never wildcard CORS with credentials
    # in production. The default below is a concrete localhost origin
    # (not "*"), and CORS_ALLOW_CREDENTIALS is only meaningful alongside
    # a concrete origin list -- FastAPI/Starlette itself rejects
    # "*" + allow_credentials=True at the browser level, but we don't
    # rely on that alone: `validate_production_secrets()` also refuses to
    # boot in production with the literal "*" origin configured.
    # -------------------------------------------------------------------
    CORS_ALLOWED_ORIGINS: str = "http://localhost:5170,http://localhost:5173,http://localhost:5174"
    CORS_ALLOW_CREDENTIALS: bool = True

    @property
    def cors_allowed_origins_list(self) -> list[str]:
        """Parse the comma-separated CORS origins string into a list."""
        return [origin.strip() for origin in self.CORS_ALLOWED_ORIGINS.split(",") if origin.strip()]

    # -------------------------------------------------------------------
    # Platform Admin Authentication (Phase 3)
    #
    # Human control-plane administrators. Deliberately separate signing
    # secret from anything Yinglima/Inhyma use -- an ERP_Main token must
    # never be mistaken for, or verifiable as, a local ERP's JWT, and vice
    # versa. Session tokens are short-lived by design: this is an admin
    # console, not a high-traffic API, so a longer-lived refresh-token
    # dance (as Yinglima has) is intentionally NOT built here in Phase 3 --
    # a platform admin re-authenticating occasionally is an acceptable
    # trade-off for a much smaller attack surface. See
    # `app.platform_auth` for where this is consumed.
    # -------------------------------------------------------------------
    PLATFORM_JWT_SECRET_KEY: str = Field(
        default="CHANGE-ME-IN-PRODUCTION-platform-admin-secret",
        description="HMAC signing secret for platform-admin session tokens. MUST be overridden via env "
        "in every non-local environment.",
    )
    PLATFORM_JWT_ALGORITHM: str = "HS256"
    PLATFORM_JWT_ISSUER: str = "erp-main-control-plane"
    PLATFORM_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # -------------------------------------------------------------------
    # ERP Service Identity / Credentials (Phase 3)
    #
    # Machine-to-machine authentication for ERP instances calling back
    # into ERP_Main (heartbeat, future local-user verification). The
    # credential SECRET is generated once, shown to the operator exactly
    # once at creation/rotation time, and never stored -- only its hash
    # (see `app.service_identity.security`). This pepper is mixed into
    # that hash so a stolen database dump alone can't be used to forge
    # valid credentials even if an attacker also guesses/brute-forces a
    # weak generated secret (defense in depth; the generated secrets
    # themselves are already high-entropy, see `generate_service_secret`).
    # -------------------------------------------------------------------
    SERVICE_CREDENTIAL_PEPPER: str = Field(
        default="CHANGE-ME-IN-PRODUCTION-service-credential-pepper",
        description="Server-side pepper mixed into ERP service credential hashing. MUST be overridden "
        "via env in every non-local environment, and MUST differ from PLATFORM_JWT_SECRET_KEY.",
    )

    @property
    def is_production(self) -> bool:
        """Return True when running in the production environment."""
        return self.ENVIRONMENT == EnvironmentEnum.PRODUCTION

    def validate_production_secrets(self) -> None:
        """
        Refuse to boot in production with placeholder secrets or wildcard CORS.

        Called explicitly from the application lifespan (not from
        `__init__`) so that unit tests / local tooling importing
        `Settings` never trip this check unexpectedly -- mirrors
        Yinglima_ERP's identical `validate_production_secrets` pattern.
        """
        if self.is_production and "CHANGE-ME" in self.PLATFORM_JWT_SECRET_KEY:
            raise RuntimeError(
                "PLATFORM_JWT_SECRET_KEY is still set to its placeholder value in a production "
                "environment. Set a strong, random PLATFORM_JWT_SECRET_KEY via the environment."
            )
        if self.is_production and "CHANGE-ME" in self.SERVICE_CREDENTIAL_PEPPER:
            raise RuntimeError(
                "SERVICE_CREDENTIAL_PEPPER is still set to its placeholder value in a production "
                "environment. Set a strong, random SERVICE_CREDENTIAL_PEPPER via the environment."
            )
        if self.PLATFORM_JWT_SECRET_KEY == self.SERVICE_CREDENTIAL_PEPPER:
            raise RuntimeError(
                "PLATFORM_JWT_SECRET_KEY and SERVICE_CREDENTIAL_PEPPER must be different values."
            )
        if self.is_production and "*" in self.cors_allowed_origins_list:
            raise RuntimeError(
                "CORS_ALLOWED_ORIGINS must not be '*' in a production environment when "
                "CORS_ALLOW_CREDENTIALS is enabled."
            )


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide cached `Settings` instance."""
    return Settings()


settings = get_settings()

