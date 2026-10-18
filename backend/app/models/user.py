from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, func
from sqlalchemy.orm import relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    drive_credentials = Column(Text, nullable=True)  # JSON-encoded Google Drive OAuth tokens
    sites_sync_token = Column(Text, nullable=True)  # Fernet-encrypted Sites pairing token
    sites_user_id = Column(String(255), unique=True, index=True, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    videos = relationship("Video", back_populates="user", cascade="all, delete-orphan")
