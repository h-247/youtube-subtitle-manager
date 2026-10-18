from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
from app.database import Base


class Video(Base):
    __tablename__ = "videos"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    video_id = Column(String(64), nullable=False, index=True)
    youtube_url = Column(String(512), nullable=False)
    title = Column(String(512), nullable=False)
    channel_title = Column(String(256), nullable=True)
    channel_url = Column(String(512), nullable=True)
    duration = Column(Integer, nullable=True)  # in seconds
    thumbnail_url = Column(String(1024), nullable=True)

    # Subtitle download status: PENDING, PROCESSING, COMPLETED, NO_SUBTITLES, FAILED
    status = Column(String(32), default="PENDING", nullable=False, index=True)

    # Watch status: TO_DO, DOING, DONE
    watch_status = Column(String(32), default="TO_DO", nullable=False, index=True)

    # Channel tags (comma-separated, e.g. 'en, it, ss')
    channel_tags = Column(String(256), nullable=True, index=True)

    # Subtitle info: MANUAL, AUTO, NONE
    subtitle_type = Column(String(32), default="NONE", nullable=False)
    subtitle_language = Column(String(32), default="en", nullable=True)
    subtitle_text = Column(Text, nullable=True)

    # Google Drive metadata
    drive_file_id = Column(String(256), nullable=True)
    drive_file_url = Column(String(1024), nullable=True)

    # User editable notes / ChatGPT link
    chatgpt_link = Column(String(1024), nullable=True)

    # Retry and progress tracking
    retry_count = Column(Integer, default=0, nullable=False)
    progress_message = Column(Text, nullable=True)

    # Error message if processing failed
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User", back_populates="videos")

    __table_args__ = (
        UniqueConstraint("user_id", "video_id", name="uq_user_video"),
    )
