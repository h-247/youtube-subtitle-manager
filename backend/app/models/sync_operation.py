from sqlalchemy import Column, Integer, String, Text, Float, ForeignKey
from app.database import Base


class SyncOperation(Base):
    __tablename__ = "sync_operations"
    __table_args__ = {"sqlite_autoincrement": True}
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    video_id = Column(String(64), nullable=False)
    operation = Column(String(16), nullable=False)
    payload = Column(Text, nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    next_attempt = Column(Float, nullable=False, default=0)
    error = Column(Text)
