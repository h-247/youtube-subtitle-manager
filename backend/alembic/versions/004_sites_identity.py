"""link local accounts to their ChatGPT Sites identity"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "004_sites_identity"
down_revision: Union[str, None] = "003_sites_local_sync"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("sites_user_id", sa.String(length=255), nullable=True))
    op.create_index("ix_users_sites_user_id", "users", ["sites_user_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_sites_user_id", table_name="users")
    op.drop_column("users", "sites_user_id")
