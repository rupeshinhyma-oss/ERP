"""
Global Authentication ORM Models.

Owns `global_user_credentials` (one password credential per GlobalUser)
and `global_sessions` (revocable, short-lived session records) -- the two
tables that let a GlobalUser log directly into ERP_Main (Phase 4 Step 8).

Deliberately kept separate from `app.global_users.models.GlobalUser`
itself (Phase 3's own design: GlobalUser stays a thin identity record).
Also deliberately separate from `app.platform_auth` -- that module
authenticates control-plane *administrators*; this module authenticates
*Global Users*, the end-user identity that gets ERP Memberships. They are
different security principals with different tables, different password
hashes, and different token-signing material, even though the hashing
algorithm choice (Argon2id) is the same for both.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.global_users.models import GlobalUser


class GlobalUserCredential(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A GlobalUser's own global authentication password credential.

    One row per GlobalUser (enforced by the unique constraint on
    `global_user_id`). Never copied from, or shared with, any local ERP's
    own password hash (Phase 4 Step 9) -- this is a genuinely separate
    credential a Global User must establish for themselves.
    """

    __tablename__ = "global_user_credentials"

    global_user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("global_users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # MFA foundation (Phase 4 Step 11): the model can express "a TOTP
    # secret exists and is enabled" without Phase 4 actually implementing
    # challenge/verify flows. `mfa_totp_secret_encrypted` is deliberately
    # never populated by anything in this phase -- the column exists so a
    # later phase adds MFA verification logic without a migration, not so
    # Phase 4 can claim MFA is "done." Never store a raw/plaintext TOTP
    # secret -- if a later phase populates this, it must be encrypted at
    # rest, hence the column name.
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mfa_totp_secret_encrypted: Mapped[str | None] = mapped_column(String(500), nullable=True)

    global_user: Mapped[GlobalUser] = relationship()

    def __repr__(self) -> str:
        """Return a debug-friendly representation (never includes the password hash)."""
        return f"<GlobalUserCredential global_user_id={self.global_user_id}>"


class GlobalSession(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A revocable global session (Phase 4 Step 12).

    NOT an infinitely-valid JWT -- the JWT/access-token issued to the
    browser encodes this row's `id` as its `jti`/session reference, and
    `app.global_auth.security.verify_access_token` checks this row's
    `revoked_at`/`expires_at` on every request, so revoking a session here
    takes effect immediately regardless of the token's own `exp` claim.
    """

    __tablename__ = "global_sessions"

    global_user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("global_users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)

    global_user: Mapped[GlobalUser] = relationship()

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<GlobalSession id={self.id} global_user_id={self.global_user_id}>"
