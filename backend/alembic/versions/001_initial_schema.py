"""initial schema

Revision ID: 001_initial_schema
Revises: 
Create Date: 2026-10-07 14:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create users table
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('hashed_password', sa.String(length=255), nullable=False),
        sa.Column('drive_credentials', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)

    # Create videos table
    op.create_table(
        'videos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('video_id', sa.String(length=64), nullable=False),
        sa.Column('youtube_url', sa.String(length=512), nullable=False),
        sa.Column('title', sa.String(length=512), nullable=False),
        sa.Column('channel_title', sa.String(length=256), nullable=True),
        sa.Column('duration', sa.Integer(), nullable=True),
        sa.Column('thumbnail_url', sa.String(length=1024), nullable=True),
        sa.Column('status', sa.String(length=32), server_default='PENDING', nullable=False),
        sa.Column('subtitle_type', sa.String(length=32), server_default='NONE', nullable=False),
        sa.Column('subtitle_language', sa.String(length=32), server_default='en', nullable=True),
        sa.Column('drive_file_id', sa.String(length=256), nullable=True),
        sa.Column('drive_file_url', sa.String(length=1024), nullable=True),
        sa.Column('chatgpt_link', sa.String(length=1024), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'video_id', name='uq_user_video')
    )
    op.create_index(op.f('ix_videos_id'), 'videos', ['id'], unique=False)
    op.create_index(op.f('ix_videos_user_id'), 'videos', ['user_id'], unique=False)
    op.create_index(op.f('ix_videos_video_id'), 'videos', ['video_id'], unique=False)
    op.create_index(op.f('ix_videos_status'), 'videos', ['status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_videos_status'), table_name='videos')
    op.drop_index(op.f('ix_videos_video_id'), table_name='videos')
    op.drop_index(op.f('ix_videos_user_id'), table_name='videos')
    op.drop_index(op.f('ix_videos_id'), table_name='videos')
    op.drop_table('videos')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_index(op.f('ix_users_id'), table_name='users')
    op.drop_table('users')
