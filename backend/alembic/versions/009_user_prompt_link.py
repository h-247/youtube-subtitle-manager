"""Store one ChatGPT prompt link per library owner."""
from alembic import op
import sqlalchemy as sa

revision = "009_user_prompt_link"
down_revision = "008_playlist_memberships"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("chatgpt_prompt_link", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("users", "chatgpt_prompt_link")
