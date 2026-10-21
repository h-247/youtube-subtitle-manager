"""Persist exact YouTube source playlist memberships for safe cleanup."""
from alembic import op
import sqlalchemy as sa
revision = "008_playlist_memberships"
down_revision = "007_video_tags"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("videos", sa.Column("playlist_items_json", sa.Text(), nullable=True))

def downgrade():
    op.drop_column("videos", "playlist_items_json")
