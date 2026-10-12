from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, HttpUrl, Field, ConfigDict


class VideoIngestRequest(BaseModel):
    url: str = Field(..., description="YouTube video URL, Shorts URL, or Playlist URL")


class VideoUpdate(BaseModel):
    status: Optional[str] = Field(None, description="Subtitle status: PENDING, PROCESSING, COMPLETED, NO_SUBTITLES, FAILED")
    watch_status: Optional[str] = Field(None, description="Watch status: TO_DO, DOING, DONE")
    chatgpt_link: Optional[str] = Field(None, description="Custom link to ChatGPT conversation")
    channel_tags: Optional[str] = Field(None, description="Channel tags (comma-separated, e.g. 'en, it, ss')")


class ChannelTagUpdate(BaseModel):
    channel_title: str
    tags: str


class ChannelTagRead(BaseModel):
    channel_title: str
    tags: List[str]


class ChannelItem(BaseModel):
    channel_title: str
    channel_url: Optional[str] = None
    channel_tags: Optional[str] = None
    tags: List[str] = []
    video_count: int = 0


class VideoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    video_id: str
    youtube_url: str
    title: str
    channel_title: Optional[str] = None
    channel_url: Optional[str] = None
    channel_tags: Optional[str] = None
    duration: Optional[int] = None
    thumbnail_url: Optional[str] = None
    status: str
    watch_status: str = "TO_DO"
    subtitle_type: str
    subtitle_language: Optional[str] = None
    drive_file_id: Optional[str] = None
    drive_file_url: Optional[str] = None
    chatgpt_link: Optional[str] = None
    retry_count: int = 0
    progress_message: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class VideoIngestResultItem(BaseModel):
    video_id: str
    title: str
    status: str
    subtitle_type: str
    is_duplicate: bool = False
    error: Optional[str] = None
    video: Optional[VideoRead] = None


class VideoIngestResponse(BaseModel):
    total_found: int
    processed: int
    skipped_duplicates: int
    failed: int
    results: List[VideoIngestResultItem]


class VideoListResponse(BaseModel):
    items: List[VideoRead]
    total: int
    page: int
    page_size: int
    total_pages: int
