"""Durable subtitle checkpoint and sync acknowledgement."""
from alembic import op
import sqlalchemy as sa
revision = "006_processing_checkpoint"
down_revision = "005_durable_sync"
branch_labels = None
depends_on = None

def upgrade():
    for name in ("sites_synced", "download_complete", "processing_paused"):
        op.add_column("videos", sa.Column(name, sa.Integer(), nullable=False, server_default="0"))
    op.add_column("videos", sa.Column("error_category", sa.String(32)))
    # Prevent operation ID reuse while a network acknowledgement is in flight.
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("sync_operations", recreate="always", table_kwargs={"sqlite_autoincrement": True}):
            pass

def downgrade():
    for name in ("error_category", "processing_paused", "download_complete", "sites_synced"):
        op.drop_column("videos", name)
