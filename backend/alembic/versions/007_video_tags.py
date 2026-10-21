"""Independent video tags with lossless playlist names."""
from alembic import op
import sqlalchemy as sa
revision = "007_video_tags"
down_revision = "006_processing_checkpoint"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("videos", sa.Column("tags_json", sa.Text(), nullable=True))

def downgrade():
    op.drop_column("videos", "tags_json")
