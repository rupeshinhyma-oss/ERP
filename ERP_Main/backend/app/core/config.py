"""
ERP_Main Configuration.

All runtime configuration is centralized here, following the same pattern
as Yinglima_ERP's `app.core.config`: one `Settings` object, sourced from
environment variables (with a local `.env` for development), and nothing
else in the codebase reads `os.environ` directly.

Scope note (Phase 2 -> Phase 3 -> Phase 4)
--------------------------------------------
Phase 2 shipped the ERP Registry only, with no authentication at all.
Phase 3 added the control plane's first two security principals:
- Platform administrators (humans) -- `PLATFORM_JWT_SECRET_KEY` etc. below.
- ERP services (machines) -- service-credential hashing lives in
  `app.service_identity.security`, reusing `PLATFORM_JWT_SECRET_KEY`'s
  sibling constant only where noted; the credential SECRET itself is
  never stored, only its hash (see that module).
Phase 4 adds a THIRD, separate security principal -- Global Users (the
end-user identity that holds ERP Memberships) -- plus the federation
layer that issues them tokens Yinglima/Inhyma can verify. Four
independent signing domains now exist in this one process
(`PLATFORM_JWT_SECRET_KEY`, `SERVICE_CREDENTIAL_PEPPER`,
`GLOBAL_AUTH_JWT_SECRET_KEY`, and the RSA keypair(s) in
`app.federation`), deliberately never reused across each other, so a
token from one domain can never be replayed as valid in another.
Every secret-shaped field below follows Yinglima's own convention: a
clearly-fake `CHANGE-ME-IN-PRODUCTION` default so local dev works with
zero setup, paired with `validate_production_secrets()` refusing to boot
in production with that default still in place.
"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
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
    DATABASE_POOL_SIZE: int = 10
    DATABASE_MAX_OVERFLOW: int = 10
    DATABASE_POOL_TIMEOUT_SECONDS: int = 30
    DATABASE_POOL_RECYCLE_SECONDS: int = 1800
    DATABASE_DISABLE_STATEMENT_CACHE: bool = True

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def normalize_database_url(cls, v: str) -> str:
        if isinstance(v, str):
            v = v.strip().strip("'\"")
            if v.startswith("postgres://"):
                return "postgresql+asyncpg://" + v[len("postgres://"):]
            if v.startswith("postgresql://") and not v.startswith("postgresql+asyncpg://"):
                return "postgresql+asyncpg://" + v[len("postgresql://"):]
        return v

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
    CORS_ALLOWED_ORIGINS: str = "http://localhost:5173"
    CORS_ALLOW_CREDENTIALS: bool = True
    ALLOW_LOCAL_URLS: bool = False

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
    PLATFORM_ACCESS_TOKEN_EXPIRE_MINUTES: int = 5256000

    # -------------------------------------------------------------------
    # Platform Bootstrap Admin Credentials
    # -------------------------------------------------------------------
    BOOTSTRAP_ADMIN_EMAIL: str = Field(
        default="admin@example.com",
        description="Bootstrap platform admin email address.",
    )
    BOOTSTRAP_ADMIN_PASSWORD: str = Field(
        default="ChangeMe!12345",
        description="Bootstrap platform admin password.",
    )
    BOOTSTRAP_ADMIN_NAME: str = Field(
        default="Platform Super Admin",
        description="Bootstrap platform admin display name.",
    )

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

    # -------------------------------------------------------------------
    # Global User Authentication (Phase 4)
    #
    # Global Users (end users with ERP Memberships) authenticate directly
    # against ERP_Main using this password credential and signing secret --
    # entirely separate from PLATFORM_JWT_SECRET_KEY (admins) and from the
    # RSA federation keys (tokens issued TO Yinglima/Inhyma). A Global
    # User's session access token is only ever valid for calling ERP_Main
    # itself (e.g. "list my memberships"); it is never accepted by any ERP
    # -- that requires the separate federation exchange in `app.federation`.
    # -------------------------------------------------------------------
    GLOBAL_AUTH_JWT_SECRET_KEY: str = Field(
        default="CHANGE-ME-IN-PRODUCTION-global-auth-secret",
        description="HMAC signing secret for Global User session access tokens. MUST be overridden via "
        "env in every non-local environment, and MUST differ from every other secret in this Settings.",
    )
    GLOBAL_AUTH_JWT_ALGORITHM: str = "HS256"
    GLOBAL_AUTH_JWT_ISSUER: str = "erp-main-global-auth"
    GLOBAL_ACCESS_TOKEN_EXPIRE_MINUTES: int = 5256000
    GLOBAL_SESSION_MAX_LIFETIME_HOURS: int = 87600

    # Password policy (Phase 4 Step 10) -- identical shape to Yinglima's
    # own `PASSWORD_*`/`MAX_FAILED_LOGIN_ATTEMPTS`/`ACCOUNT_LOCK_MINUTES`
    # settings, applied here to the separate global credential.
    GLOBAL_PASSWORD_MIN_LENGTH: int = 10
    GLOBAL_PASSWORD_REQUIRE_UPPERCASE: bool = True
    GLOBAL_PASSWORD_REQUIRE_LOWERCASE: bool = True
    GLOBAL_PASSWORD_REQUIRE_DIGIT: bool = True
    GLOBAL_PASSWORD_REQUIRE_SPECIAL: bool = True
    GLOBAL_MAX_FAILED_LOGIN_ATTEMPTS: int = 5
    GLOBAL_ACCOUNT_LOCK_MINUTES: int = 15

    # Password reset (Phase 4 Step 43): short-lived, single-use tokens.
    GLOBAL_PASSWORD_RESET_TOKEN_EXPIRE_MINUTES: int = 30

    # Login rate limiting (Phase 4 Step 42) -- same shape as Yinglima's
    # own `LOGIN_RATE_LIMIT_*`, reused here rather than inventing a
    # second mechanism, per that step's explicit instruction.
    GLOBAL_LOGIN_RATE_LIMIT_MAX_ATTEMPTS: int = 10
    GLOBAL_LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = 300

    # -------------------------------------------------------------------
    # Federation / OIDC (Phase 4)
    #
    # ERP_Main acts as the OIDC-flavored Identity Provider / Authorization
    # Server (Step 3); Yinglima/Inhyma act as Relying Parties. Tokens are
    # signed with RSA (RS256) so ERPs only ever need the PUBLIC half
    # (via JWKS) -- the private key never leaves ERP_Main (Step 5).
    # -------------------------------------------------------------------
    FEDERATION_ISSUER: str = Field(
        default="http://localhost:8100",
        description="This ERP_Main instance's OIDC issuer URL. Must exactly match what ERPs are "
        "configured to expect as `iss` -- see app.federation.",
    )
    FEDERATION_AUTHORIZATION_CODE_EXPIRE_SECONDS: int = 60
    FEDERATION_ID_TOKEN_EXPIRE_MINUTES: int = 5
    FEDERATION_SIGNING_KEY_DIR: str = Field(
        default="./federation_keys",
        description="Directory where RSA signing keypairs are persisted (Phase 4 Step 5/6). Contains "
        "PRIVATE key material -- must never be committed to source control or served publicly. Only "
        "the public half is ever exposed, via /api/v1/.well-known/jwks.json.",
    )
    FEDERATION_CLIENT_SECRET_PEPPER: str = Field(
        default="CHANGE-ME-IN-PRODUCTION-federation-client-secret-pepper",
        description="Server-side pepper mixed into FederationClient.client_secret hashing. MUST be "
        "overridden via env in every non-local environment, and MUST differ from every other secret "
        "in this Settings.",
    )

    # -------------------------------------------------------------------
    # Feature Flags (Phase 4 Step 67) -- centralized here, not scattered.
    # -------------------------------------------------------------------
    GLOBAL_AUTH_ENABLED: bool = True
    FEDERATION_ENABLED: bool = True
    YINGLIMA_SSO_ENABLED: bool = True
    INHYMA_SSO_ENABLED: bool = True

    # Reporting and partner service auth
    FEDERATION_SERVICE_CREDENTIAL: str = Field(
        default="CHANGE-ME-IN-PRODUCTION-erp-main-service-credential",
        description="Shared service credential used to call partner ERP internal endpoints.",
    )
    REPORT_EXPORT_DIR: str = Field(
        default="./app/reporting/exports",
        description="Filesystem directory for generated report export files.",
    )

    @property
    def federation_signing_key_path(self) -> Path:
        """Return the directory path for federation signing keys as a `Path`."""
        return Path(self.FEDERATION_SIGNING_KEY_DIR)

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
        if self.is_production and "CHANGE-ME" in self.GLOBAL_AUTH_JWT_SECRET_KEY:
            raise RuntimeError(
                "GLOBAL_AUTH_JWT_SECRET_KEY is still set to its placeholder value in a production "
                "environment. Set a strong, random GLOBAL_AUTH_JWT_SECRET_KEY via the environment."
            )
        if self.is_production and "CHANGE-ME" in self.FEDERATION_CLIENT_SECRET_PEPPER:
            raise RuntimeError(
                "FEDERATION_CLIENT_SECRET_PEPPER is still set to its placeholder value in a production "
                "environment. Set a strong, random FEDERATION_CLIENT_SECRET_PEPPER via the environment."
            )
        _secrets = {
            "PLATFORM_JWT_SECRET_KEY": self.PLATFORM_JWT_SECRET_KEY,
            "SERVICE_CREDENTIAL_PEPPER": self.SERVICE_CREDENTIAL_PEPPER,
            "GLOBAL_AUTH_JWT_SECRET_KEY": self.GLOBAL_AUTH_JWT_SECRET_KEY,
            "FEDERATION_CLIENT_SECRET_PEPPER": self.FEDERATION_CLIENT_SECRET_PEPPER,
        }
        _seen: dict[str, str] = {}
        for name, value in _secrets.items():
            if value in _seen.values():
                raise RuntimeError(
                    f"{name} must not equal another secret in this Settings (found a duplicate value). "
                    "Every signing domain must use its own independent secret."
                )
            _seen[name] = value
        if self.is_production and "*" in self.cors_allowed_origins_list:
            raise RuntimeError(
                "CORS_ALLOWED_ORIGINS must not be '*' in a production environment when "
                "CORS_ALLOW_CREDENTIALS is enabled."
            )
        if self.is_production and "sqlite" in self.DATABASE_URL.lower():
            raise RuntimeError(
                "DATABASE_URL cannot use SQLite in a production environment. Configure Supabase PostgreSQL."
            )


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide cached `Settings` instance."""
    return Settings()


settings = get_settings()

