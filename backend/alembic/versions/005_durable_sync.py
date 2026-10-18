"""Persist Sites outbox."""
from alembic import op
import sqlalchemy as sa
revision = "005_durable_sync"
down_revision = "004_sites_identity"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("sync_operations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("video_id", sa.String(64), nullable=False),
        sa.Column("operation", sa.String(16), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt", sa.Float(), nullable=False),
        sa.Column("error", sa.Text()))
    op.create_index("ix_sync_operations_user_id", "sync_operations", ["user_id"])


def downgrade():
    op.drop_table("sync_operations")
