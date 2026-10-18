"""persist Sites pairing and local subtitle text"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "003_sites_local_sync"
down_revision: Union[str, None] = "002_video_processing_progress"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("sites_sync_token", sa.Text(), nullable=True))
    op.add_column("videos", sa.Column("subtitle_text", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("videos", "subtitle_text")
    op.drop_column("users", "sites_sync_token")
