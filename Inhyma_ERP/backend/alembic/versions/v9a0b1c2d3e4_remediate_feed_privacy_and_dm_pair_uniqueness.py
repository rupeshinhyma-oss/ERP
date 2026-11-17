"""remediate_feed_privacy_and_dm_pair_uniqueness

Revision ID: v9a0b1c2d3e4
Revises: z8f9a0b1c2d3
Create Date: 2026-11-17 11:00:00.000000

Implements Feed remediation database schema & safe historical data backfill:
1. Adds ``is_explicit`` (BOOLEAN NOT NULL DEFAULT TRUE) on ``feed_post_recipients``
   so explicitly selected individual recipients are separated from historical
   department-snapshot rows without deleting historical recipient records.
   Pre-existing rows on posts that targeted departments (``feed_post_departments``)
   are marked ``is_explicit = FALSE`` so confidentiality is preserved when former
   department members transfer out, while active department members retain dynamic
   access via ``feed_post_departments``.
2. Adds canonical ``participant_low_id`` and ``participant_high_id`` columns on
   ``feed_conversations``, deterministically consolidates any historical duplicate
   1:1 conversations while preserving 100% of message history and unread state,
   and creates the partial unique index ``uq_feed_conversations_active_pair``.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.database.base import GUID

revision: str = "v9a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "z9a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    dialect = bind.dialect.name

    # ------------------------------------------------------------------
    # 1. feed_post_recipients.is_explicit + safe historical classification
    # ------------------------------------------------------------------
    if insp.has_table("feed_post_recipients"):
        rec_cols = {c["name"] for c in insp.get_columns("feed_post_recipients")}
        added_is_explicit = False
        if "is_explicit" not in rec_cols:
            op.add_column(
                "feed_post_recipients",
                sa.Column(
                    "is_explicit",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.true(),
                ),
            )
            added_is_explicit = True

        insp = sa.inspect(bind)
        rec_indexes = {idx["name"] for idx in insp.get_indexes("feed_post_recipients")}
        if "ix_feed_post_recipients_post_explicit" not in rec_indexes:
            op.create_index(
                "ix_feed_post_recipients_post_explicit",
                "feed_post_recipients",
                ["post_id", "is_explicit"],
                unique=False,
            )

        # Backfill only once when upgrading from the pre-remediation schema:
        # On posts that targeted departments (`feed_post_departments`), historical
        # `feed_post_recipients` rows may contain point-in-time department snapshots.
        # Prefer confidentiality over unintended post-transfer retention while keeping
        # pure individual posts (`NOT EXISTS feed_post_departments`) as `is_explicit = TRUE`.
        if added_is_explicit and insp.has_table("feed_post_departments"):
            bind.execute(
                sa.text(
                    """
                    UPDATE feed_post_recipients
                    SET is_explicit = FALSE
                    WHERE EXISTS (
                        SELECT 1
                        FROM feed_post_departments d
                        WHERE d.post_id = feed_post_recipients.post_id
                    )
                    """
                )
            )

    # ------------------------------------------------------------------
    # 2. feed_conversations canonical 1:1 pair columns + duplicate merge
    # ------------------------------------------------------------------
    if insp.has_table("feed_conversations"):
        conv_cols = {c["name"] for c in insp.get_columns("feed_conversations")}
        if "participant_low_id" not in conv_cols:
            op.add_column(
                "feed_conversations",
                sa.Column("participant_low_id", GUID(), nullable=True),
            )
        if "participant_high_id" not in conv_cols:
            op.add_column(
                "feed_conversations",
                sa.Column("participant_high_id", GUID(), nullable=True),
            )

        insp = sa.inspect(bind)
        conv_fks = {fk["name"] for fk in insp.get_foreign_keys("feed_conversations") if fk.get("name")}
        if "fk_feed_conversations_participant_low_id" not in conv_fks:
            op.create_foreign_key(
                "fk_feed_conversations_participant_low_id",
                "feed_conversations",
                "users",
                ["participant_low_id"],
                ["id"],
                ondelete="CASCADE",
            )
        if "fk_feed_conversations_participant_high_id" not in conv_fks:
            op.create_foreign_key(
                "fk_feed_conversations_participant_high_id",
                "feed_conversations",
                "users",
                ["participant_high_id"],
                ["id"],
                ondelete="CASCADE",
            )

        conv_checks = {
            ck["name"] for ck in insp.get_check_constraints("feed_conversations") if ck.get("name")
        }
        if "ck_feed_conversations_pair_distinct" not in conv_checks:
            op.create_check_constraint(
                "ck_feed_conversations_pair_distinct",
                "feed_conversations",
                "participant_low_id IS NULL OR participant_high_id IS NULL OR participant_low_id <> participant_high_id",
            )

        # Backfill canonical pair IDs and deterministically consolidate any duplicates
        if insp.has_table("feed_conversation_participants"):
            if dialect == "postgresql":
                bind.execute(
                    sa.text(
                        """
                        WITH pair_map AS (
                            SELECT
                                cp.conversation_id,
                                MIN(cp.user_id::text)::uuid AS low_id,
                                MAX(cp.user_id::text)::uuid AS high_id,
                                COUNT(DISTINCT cp.user_id) AS part_cnt
                            FROM feed_conversation_participants cp
                            GROUP BY cp.conversation_id
                            HAVING COUNT(DISTINCT cp.user_id) = 2
                        )
                        UPDATE feed_conversations c
                        SET participant_low_id = pm.low_id,
                            participant_high_id = pm.high_id
                        FROM pair_map pm
                        WHERE c.id = pm.conversation_id
                          AND (c.participant_low_id IS NULL OR c.participant_high_id IS NULL)
                        """
                    )
                )

                # Inspect and consolidate duplicate active conversations per canonical pair
                dup_pairs = bind.execute(
                    sa.text(
                        """
                        SELECT participant_low_id, participant_high_id
                        FROM feed_conversations
                        WHERE deleted_at IS NULL
                          AND participant_low_id IS NOT NULL
                          AND participant_high_id IS NOT NULL
                        GROUP BY participant_low_id, participant_high_id
                        HAVING COUNT(*) > 1
                        """
                    )
                ).fetchall()

                for low_id, high_id in dup_pairs:
                    conv_rows = bind.execute(
                        sa.text(
                            """
                            SELECT id
                            FROM feed_conversations
                            WHERE deleted_at IS NULL
                              AND participant_low_id = :low_id
                              AND participant_high_id = :high_id
                            ORDER BY created_at ASC, id ASC
                            """
                        ),
                        {"low_id": low_id, "high_id": high_id},
                    ).fetchall()
                    if len(conv_rows) <= 1:
                        continue

                    canonical_id = conv_rows[0][0]
                    dup_ids = [r[0] for r in conv_rows[1:]]

                    for dup_id in dup_ids:
                        # 1. Preserve 100% of direct messages by moving them to canonical_id
                        bind.execute(
                            sa.text(
                                """
                                UPDATE feed_direct_messages
                                SET conversation_id = :canonical_id
                                WHERE conversation_id = :dup_id
                                """
                            ),
                            {"canonical_id": canonical_id, "dup_id": dup_id},
                        )

                        # 2. Merge participant last_read_at onto canonical participant rows
                        bind.execute(
                            sa.text(
                                """
                                UPDATE feed_conversation_participants cp_canon
                                SET last_read_at = CASE
                                    WHEN cp_canon.last_read_at IS NULL THEN cp_dup.last_read_at
                                    WHEN cp_dup.last_read_at IS NULL THEN cp_canon.last_read_at
                                    ELSE GREATEST(cp_canon.last_read_at, cp_dup.last_read_at)
                                END
                                FROM feed_conversation_participants cp_dup
                                WHERE cp_canon.conversation_id = :canonical_id
                                  AND cp_dup.conversation_id = :dup_id
                                  AND cp_canon.user_id = cp_dup.user_id
                                """
                            ),
                            {"canonical_id": canonical_id, "dup_id": dup_id},
                        )

                        # 3. Rewrite notification deep-links pointing to dup_id -> canonical_id
                        if insp.has_table("notifications"):
                            bind.execute(
                                sa.text(
                                    """
                                    UPDATE notifications
                                    SET link = :canon_link
                                    WHERE link = :dup_link
                                    """
                                ),
                                {
                                    "canon_link": f"/feed?tab=messages&conversation_id={canonical_id}",
                                    "dup_link": f"/feed?tab=messages&conversation_id={dup_id}",
                                },
                            )

                        # 4. Soft-delete superseded duplicate shell (preserving row audit history)
                        bind.execute(
                            sa.text(
                                """
                                UPDATE feed_conversations
                                SET deleted_at = CURRENT_TIMESTAMP,
                                    updated_at = CURRENT_TIMESTAMP
                                WHERE id = :dup_id
                                """
                            ),
                            {"dup_id": dup_id},
                        )

                    # 5. Recompute canonical preview & exact unread counts from merged non-deleted messages
                    bind.execute(
                        sa.text(
                            """
                            UPDATE feed_conversation_participants cp
                            SET unread_count = COALESCE((
                                SELECT COUNT(*)
                                FROM feed_direct_messages m
                                WHERE m.conversation_id = :canonical_id
                                  AND m.deleted_at IS NULL
                                  AND m.sender_id <> cp.user_id
                                  AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
                            ), 0)
                            WHERE cp.conversation_id = :canonical_id
                            """
                        ),
                        {"canonical_id": canonical_id},
                    )

                    latest_msg = bind.execute(
                        sa.text(
                            """
                            SELECT created_at, LEFT(content, 150) AS preview, sender_id
                            FROM feed_direct_messages
                            WHERE conversation_id = :canonical_id
                              AND deleted_at IS NULL
                            ORDER BY created_at DESC, id DESC
                            LIMIT 1
                            """
                        ),
                        {"canonical_id": canonical_id},
                    ).fetchone()

                    bind.execute(
                        sa.text(
                            """
                            UPDATE feed_conversations
                            SET last_message_at = :lm_at,
                                last_message_preview = :lm_prev,
                                last_message_sender_id = :lm_sender,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = :canonical_id
                            """
                        ),
                        {
                            "canonical_id": canonical_id,
                            "lm_at": latest_msg[0] if latest_msg else None,
                            "lm_prev": latest_msg[1] if latest_msg else None,
                            "lm_sender": latest_msg[2] if latest_msg else None,
                        },
                    )

        insp = sa.inspect(bind)
        conv_indexes = {idx["name"] for idx in insp.get_indexes("feed_conversations")}
        if "ix_feed_conversations_participant_low_id" not in conv_indexes:
            op.create_index(
                "ix_feed_conversations_participant_low_id",
                "feed_conversations",
                ["participant_low_id"],
                unique=False,
            )
        if "ix_feed_conversations_participant_high_id" not in conv_indexes:
            op.create_index(
                "ix_feed_conversations_participant_high_id",
                "feed_conversations",
                ["participant_high_id"],
                unique=False,
            )
        if "uq_feed_conversations_active_pair" not in conv_indexes:
            if dialect == "postgresql":
                op.create_index(
                    "uq_feed_conversations_active_pair",
                    "feed_conversations",
                    ["participant_low_id", "participant_high_id"],
                    unique=True,
                    postgresql_where=sa.text(
                        "deleted_at IS NULL AND participant_low_id IS NOT NULL AND participant_high_id IS NOT NULL"
                    ),
                )
            else:
                op.create_index(
                    "uq_feed_conversations_active_pair",
                    "feed_conversations",
                    ["participant_low_id", "participant_high_id"],
                    unique=False,
                )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("feed_conversations"):
        conv_indexes = {idx["name"] for idx in insp.get_indexes("feed_conversations")}
        if "uq_feed_conversations_active_pair" in conv_indexes:
            op.drop_index("uq_feed_conversations_active_pair", table_name="feed_conversations")
        if "ix_feed_conversations_participant_high_id" in conv_indexes:
            op.drop_index("ix_feed_conversations_participant_high_id", table_name="feed_conversations")
        if "ix_feed_conversations_participant_low_id" in conv_indexes:
            op.drop_index("ix_feed_conversations_participant_low_id", table_name="feed_conversations")

        conv_checks = {
            ck["name"] for ck in insp.get_check_constraints("feed_conversations") if ck.get("name")
        }
        if "ck_feed_conversations_pair_distinct" in conv_checks:
            op.drop_constraint("ck_feed_conversations_pair_distinct", "feed_conversations", type_="check")

        conv_fks = {fk["name"] for fk in insp.get_foreign_keys("feed_conversations") if fk.get("name")}
        if "fk_feed_conversations_participant_high_id" in conv_fks:
            op.drop_constraint("fk_feed_conversations_participant_high_id", "feed_conversations", type_="foreignkey")
        if "fk_feed_conversations_participant_low_id" in conv_fks:
            op.drop_constraint("fk_feed_conversations_participant_low_id", "feed_conversations", type_="foreignkey")

        conv_cols = {c["name"] for c in insp.get_columns("feed_conversations")}
        if "participant_high_id" in conv_cols:
            op.drop_column("feed_conversations", "participant_high_id")
        if "participant_low_id" in conv_cols:
            op.drop_column("feed_conversations", "participant_low_id")

    if insp.has_table("feed_post_recipients"):
        rec_indexes = {idx["name"] for idx in insp.get_indexes("feed_post_recipients")}
        if "ix_feed_post_recipients_post_explicit" in rec_indexes:
            op.drop_index("ix_feed_post_recipients_post_explicit", table_name="feed_post_recipients")
        rec_cols = {c["name"] for c in insp.get_columns("feed_post_recipients")}
        if "is_explicit" in rec_cols:
            op.drop_column("feed_post_recipients", "is_explicit")
