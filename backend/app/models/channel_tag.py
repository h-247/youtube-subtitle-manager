from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, func
from app.database import Base


class ChannelTag(Base):
    __tablename__ = "channel_tags"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    channel_title = Column(String(256), nullable=False, index=True)
    tag = Column(String(64), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "channel_title", "tag", name="uq_user_channel_tag"),
    )
