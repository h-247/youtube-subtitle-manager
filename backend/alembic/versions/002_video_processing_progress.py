"""video processing progress and retry fields

Revision ID: 002_video_processing_progress
Revises: 001_initial_schema
Create Date: 2026-10-10 14:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '002_video_processing_progress'
down_revision: Union[str, None] = '001_initial_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'videos',
        sa.Column('retry_count', sa.Integer(), server_default='0', nullable=False)
    )
    op.add_column(
        'videos',
        sa.Column('progress_message', sa.Text(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('videos', 'progress_message')
    op.drop_column('videos', 'retry_count')
