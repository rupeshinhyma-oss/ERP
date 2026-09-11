"""
Synchronization Policy Enums and Constants (Phase 8A).

Defines standardized enums for ownership models, synchronization directions,
conflict resolution strategies, delete/archive propagation strategies,
version/order tracking strategies, and policy statuses.
"""

from __future__ import annotations

from enum import Enum


class SyncOwnershipStrategy(str, Enum):
    """Authoritative ownership model for synchronized entities."""

    SOURCE_OWNED = "SOURCE_OWNED"
    TARGET_OWNED = "TARGET_OWNED"
    SHARED_MANUAL = "SHARED_MANUAL"
    SOURCE_AUTHORITATIVE = "SOURCE_AUTHORITATIVE"
    TARGET_AUTHORITATIVE = "TARGET_AUTHORITATIVE"
    SHARED = "SHARED"
    MANUAL_CONFLICT = "MANUAL_CONFLICT"


class SyncDirection(str, Enum):
    """Allowed data synchronization flow direction between ERP nodes."""

    SOURCE_TO_TARGET = "SOURCE_TO_TARGET"
    TARGET_TO_SOURCE = "TARGET_TO_SOURCE"
    BIDIRECTIONAL = "BIDIRECTIONAL"


class SyncConflictStrategy(str, Enum):
    """Strategy for resolving conflicting mutations across nodes."""

    SOURCE_WINS = "SOURCE_WINS"
    TARGET_WINS = "TARGET_WINS"
    MANUAL = "MANUAL"
    REJECT_QUARANTINE = "REJECT_QUARANTINE"
    LATEST_TIMESTAMP = "LATEST_TIMESTAMP"


class SyncDeleteStrategy(str, Enum):
    """Propagation behavior when an entity is deleted or archived at origin."""

    PROPAGATE_DELETE = "PROPAGATE_DELETE"
    PROPAGATE_ARCHIVE = "PROPAGATE_ARCHIVE"
    IGNORE_DELETE = "IGNORE_DELETE"
    MANUAL_REVIEW = "MANUAL_REVIEW"


class SyncVersionStrategy(str, Enum):
    """Approach for monotonic version and sequence validation."""

    EVENT_VERSION = "EVENT_VERSION"
    SOURCE_UPDATED_AT = "SOURCE_UPDATED_AT"
    MONOTONIC_SEQUENCE = "MONOTONIC_SEQUENCE"
    MANUAL = "MANUAL"


class SyncPolicyStatus(str, Enum):
    """Lifecycle state of an EntitySyncPolicy."""

    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    DRAFT = "DRAFT"
    DEPRECATED = "DEPRECATED"


# Master-data entity types approved for cross-ERP synchronization in Phase 8A
APPROVED_ENTITY_TYPES: frozenset[str] = frozenset({
    "buyer",
    "supplier",
    "product",
    "category",
    "brand",
    "organization",
    "uom",
    "hsn_code",
})

# High-risk entity domains explicitly forbidden during this pilot
FORBIDDEN_ENTITY_TYPES: frozenset[str] = frozenset({
    "finance",
    "payment",
    "payments",
    "payroll",
    "inventory_transaction",
    "inventory_transactions",
    "approval",
    "approvals",
    "ledger",
    "journal",
    "accounting",
})
