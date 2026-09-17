"""Alembic environment configuration for ERP_Main's own database."""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.database.base import Base

# Import every model module so their tables register on Base.metadata
# before autogenerate compares against it.
from app.erp_registry import models as _erp_registry_models  # noqa: F401
from app.platform_auth import models as _platform_auth_models  # noqa: F401
from app.global_users import models as _global_users_models  # noqa: F401
from app.erp_memberships import models as _erp_memberships_models  # noqa: F401
from app.service_identity import models as _service_identity_models  # noqa: F401
from app.global_audit import models as _global_audit_models  # noqa: F401
from app.global_auth import models as _global_auth_models  # noqa: F401
from app.federation import models as _federation_models  # noqa: F401
from app.platform_authz import models as _platform_authz_models  # noqa: F401
from app.integration import models as _integration_models  # noqa: F401
from app.reporting import models as _reporting_models  # noqa: F401
from app.sync_policy import models as _sync_policy_models  # noqa: F401

config = context.config
import re
_sync_url = re.sub(r"([?&])ssl=([a-zA-Z0-9_-]+)", r"\1sslmode=\2", settings.sync_database_url)
config.set_main_option("sqlalchemy.url", _sync_url.replace("%", "%%"))

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emits SQL, no live DB connection)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode using a synchronous engine."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
