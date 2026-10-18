import json
import math
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from app.database import get_db
from app.models.user import User
from app.models.video import Video
from app.models.channel_tag import ChannelTag
from app.schemas.video import (
    VideoIngestRequest,
    VideoIngestResponse,
    VideoIngestResultItem,
    VideoRead,
    VideoUpdate,
    VideoListResponse,
    ChannelTagUpdate,
    ChannelTagRead,
    ChannelItem,
)
from app.api.deps import get_current_user
from app.services.youtube_service import extract_items_from_url
from app.services.subtitle_service import download_subtitles
from app.services.drive_service import drive_service

from app.services.ingestion_service import queue_video_processing, is_job_active
from app.services.sites_sync_service import sync_video_async
from app.services.durable_jobs import enqueue_sync

router = APIRouter(prefix="/videos", tags=["videos"])


@router.post("/ingest", response_model=VideoIngestResponse)
def ingest_videos(
    payload: VideoIngestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Ingest a YouTube video, Short, or playlist for the authenticated user.
    Extracts metadata, performs per-user duplicate detection, creates/updates
    video records in PROCESSING state, and queues asynchronous subtitle processing.
    """
    raw_url = payload.url.strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="A valid YouTube URL must be provided.")

    extracted_items = extract_items_from_url(raw_url)
    if not extracted_items:
        raise HTTPException(
            status_code=400,
            detail="Unable to find or parse valid YouTube video(s) from the provided URL.",
        )

    results = []
    skipped_duplicates = 0
    processed = 0
    failed = 0

    videos_to_queue = []

    for item in extracted_items:
        vid_id = item["video_id"]
        # Check duplicate per user (AC2 & AC4)
        existing = (
            db.query(Video)
            .filter(Video.user_id == current_user.id, Video.video_id == vid_id)
            .first()
        )
        if existing:
            # If already processing, avoid creating a second concurrent job
            if existing.status == "PROCESSING" or is_job_active(existing.id):
                skipped_duplicates += 1
                results.append(
                    VideoIngestResultItem(
                        video_id=vid_id,
                        title=existing.title,
                        status=existing.status,
                        subtitle_type=existing.subtitle_type,
                        is_duplicate=True,
                        error=existing.error_message,
                        video=VideoRead.model_validate(existing),
                    )
                )
                continue

            # If already COMPLETED, treat as duplicate
            if existing.status == "COMPLETED":
                skipped_duplicates += 1
                results.append(
                    VideoIngestResultItem(
                        video_id=vid_id,
                        title=existing.title,
                        status=existing.status,
                        subtitle_type=existing.subtitle_type,
                        is_duplicate=True,
                        error=existing.error_message,
                        video=VideoRead.model_validate(existing),
                    )
                )
                continue

            # Reprocess the existing non-completed record (FAILED, NO_SUBTITLES, etc.)
            video = existing
            video.title = item.get("title", video.title)
            video.channel_title = item.get("channel_title", video.channel_title)
            video.channel_url = item.get("channel_url", video.channel_url)
            video.duration = item.get("duration", video.duration)
            video.thumbnail_url = item.get("thumbnail_url", video.thumbnail_url)
            video.youtube_url = item.get("youtube_url", video.youtube_url)
            video.status = "PROCESSING"
            video.subtitle_type = "NONE"
            video.retry_count = 0
            video.error_message = None
            video.progress_message = "Queued for processing..."
            db.commit()
            db.refresh(video)
        else:
            # Check if this channel has existing tags for this user
            ch_title = item.get("channel_title")
            existing_tags_str = None
            if ch_title:
                tag_rows = db.query(ChannelTag.tag).filter(
                    ChannelTag.user_id == current_user.id,
                    ChannelTag.channel_title == ch_title
                ).all()
                if tag_rows:
                    existing_tags_str = ", ".join([r[0] for r in tag_rows])

            # Create new record in PROCESSING state
            video = Video(
                user_id=current_user.id,
                video_id=vid_id,
                youtube_url=item["youtube_url"],
                title=item["title"],
                channel_title=item.get("channel_title"),
                channel_url=item.get("channel_url"),
                channel_tags=existing_tags_str,
                duration=item.get("duration"),
                thumbnail_url=item.get("thumbnail_url"),
                status="PROCESSING",
                watch_status="TO_DO",
                subtitle_type="NONE",
                retry_count=0,
                progress_message="Queued for processing...",
            )
            db.add(video)
            db.commit()
            db.refresh(video)

        videos_to_queue.append(video.id)
        processed += 1

        results.append(
            VideoIngestResultItem(
                video_id=vid_id,
                title=video.title,
                status=video.status,
                subtitle_type=video.subtitle_type,
                is_duplicate=False,
                error=video.error_message,
                video=VideoRead.model_validate(video),
            )
        )

    # Queue background processing jobs
    for v_id in videos_to_queue:
        sync_video_async(v_id)
        queue_video_processing(v_id, current_user.id)

    return VideoIngestResponse(
        total_found=len(extracted_items),
        processed=processed,
        skipped_duplicates=skipped_duplicates,
        failed=failed,
        results=results,
    )


@router.get("", response_model=VideoListResponse)
def list_videos(
    search: Optional[str] = Query(None, description="Search by title, channel, or video ID"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by subtitle status"),
    watch_status_filter: Optional[str] = Query(None, alias="watch_status", description="Filter by watch status (TO_DO, DOING, DONE)"),
    tag_filter: Optional[str] = Query(None, alias="tag", description="Filter by channel tag (e.g. en, it, ss)"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List user-scoped videos with search, status filtering, watch status filtering, tag filtering, and pagination.
    """
    query = db.query(Video).filter(Video.user_id == current_user.id)

    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Video.title.ilike(search_pattern),
                Video.channel_title.ilike(search_pattern),
                Video.video_id.ilike(search_pattern),
            )
        )

    if watch_status_filter and watch_status_filter.strip().upper() != "ALL":
        normalized_ws = watch_status_filter.strip().upper().replace(" ", "_")
        query = query.filter(
            or_(
                Video.watch_status == watch_status_filter.strip(),
                func.upper(func.replace(Video.watch_status, " ", "_")) == normalized_ws,
                func.upper(Video.watch_status) == normalized_ws,
            )
        )

    if status_filter and status_filter.strip().upper() != "ALL":
        normalized = status_filter.strip().upper().replace(" ", "_")
        if normalized in ["TO_DO", "DOING", "DONE"]:
            query = query.filter(
                or_(
                    Video.watch_status == normalized,
                    func.upper(func.replace(Video.watch_status, " ", "_")) == normalized,
                )
            )
        else:
            query = query.filter(
                or_(
                    Video.status == status_filter.strip(),
                    func.upper(func.replace(Video.status, " ", "_")) == normalized,
                    func.upper(Video.status) == normalized,
                )
            )

    if tag_filter and tag_filter.strip().upper() != "ALL":
        raw_tag = tag_filter.strip().lstrip("#").lower()
        query = query.filter(
            or_(
                Video.channel_tags.ilike(f"%{raw_tag}%"),
                Video.channel_title.in_(
                    db.query(ChannelTag.channel_title).filter(
                        ChannelTag.user_id == current_user.id,
                        func.lower(ChannelTag.tag) == raw_tag,
                    )
                ),
            )
        )

    total = query.count()
    total_pages = math.ceil(total / page_size) if total > 0 else 1

    items = (
        query.order_by(Video.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return VideoListResponse(
        items=[VideoRead.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/tags", response_model=List[str])
def get_user_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get all distinct tags used across channels for the current user.
    """
    tag_rows = db.query(ChannelTag.tag).filter(ChannelTag.user_id == current_user.id).distinct().all()
    tags_set = {r[0].lower() for r in tag_rows if r[0]}

    video_tags = db.query(Video.channel_tags).filter(
        Video.user_id == current_user.id,
        Video.channel_tags.isnot(None)
    ).all()
    for vt in video_tags:
        if vt[0]:
            for part in vt[0].split(","):
                clean = part.strip().lstrip("#").lower()
                if clean:
                    tags_set.add(clean)

    return sorted(list(tags_set))


@router.post("/channel-tags", response_model=ChannelTagRead)
def set_channel_tags(
    payload: ChannelTagUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Set tags for all videos belonging to a specific channel and persist in ChannelTag table.
    """
    ch_title = payload.channel_title.strip()
    if not ch_title:
        raise HTTPException(status_code=400, detail="Channel title is required.")

    tags = [t.strip().lstrip("#").lower() for t in payload.tags.split(",") if t.strip()]
    tags_str = ", ".join(tags) if tags else None

    # Update all videos from this channel for current user
    db.query(Video).filter(
        Video.user_id == current_user.id,
        Video.channel_title == ch_title
    ).update({"channel_tags": tags_str})

    # Update ChannelTag table
    db.query(ChannelTag).filter(
        ChannelTag.user_id == current_user.id,
        ChannelTag.channel_title == ch_title
    ).delete()
    for t in tags:
        db.add(ChannelTag(user_id=current_user.id, channel_title=ch_title, tag=t))

    for changed in db.query(Video).filter(Video.user_id == current_user.id, Video.channel_title == ch_title).all():
        enqueue_sync(db, changed)
    db.commit()
    updated_ids = db.query(Video.id).filter(
        Video.user_id == current_user.id, Video.channel_title == ch_title
    ).all()
    for (video_id,) in updated_ids:
        sync_video_async(video_id)
    return ChannelTagRead(channel_title=ch_title, tags=tags)


@router.get("/channels", response_model=List[ChannelItem])
def list_channels(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get all distinct channels for the current user with their video counts, URLs, and assigned tags.
    """
    results = (
        db.query(
            Video.channel_title,
            func.max(Video.channel_url).label("channel_url"),
            func.max(Video.channel_tags).label("channel_tags"),
            func.count(Video.id).label("video_count"),
        )
        .filter(
            Video.user_id == current_user.id,
            Video.channel_title.isnot(None),
            Video.channel_title != "",
        )
        .group_by(Video.channel_title)
        .order_by(func.count(Video.id).desc(), Video.channel_title.asc())
        .all()
    )

    channel_tags_map = {}
    channel_tag_rows = (
        db.query(ChannelTag.channel_title, ChannelTag.tag)
        .filter(ChannelTag.user_id == current_user.id)
        .all()
    )
    for ch, tg in channel_tag_rows:
        if ch not in channel_tags_map:
            channel_tags_map[ch] = []
        if tg and tg not in channel_tags_map[ch]:
            channel_tags_map[ch].append(tg)

    channel_items = []
    for row in results:
        ch_title = row.channel_title
        tags = channel_tags_map.get(ch_title, [])
        if not tags and row.channel_tags:
            tags = [t.strip().lstrip("#").lower() for t in row.channel_tags.split(",") if t.strip()]
        tags_str = ", ".join(tags) if tags else None
        channel_items.append(
            ChannelItem(
                channel_title=ch_title,
                channel_url=row.channel_url,
                channel_tags=tags_str,
                tags=tags,
                video_count=row.video_count,
            )
        )
    return channel_items


@router.get("/{video_id_or_db_id}", response_model=VideoRead)
def get_video(
    video_id_or_db_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a single video scoped strictly to current user.
    """
    query = db.query(Video).filter(Video.user_id == current_user.id)
    if video_id_or_db_id.isdigit():
        video = query.filter(
            or_(Video.id == int(video_id_or_db_id), Video.video_id == video_id_or_db_id)
        ).first()
    else:
        video = query.filter(Video.video_id == video_id_or_db_id).first()

    if not video:
        raise HTTPException(status_code=404, detail="Video not found.")

    return VideoRead.model_validate(video)


@router.patch("/{video_db_id}", response_model=VideoRead)
def update_video(
    video_db_id: int,
    payload: VideoUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Edit video watch status, subtitle status, ChatGPT link, and/or channel tags.
    """
    video = (
        db.query(Video)
        .filter(Video.id == video_db_id, Video.user_id == current_user.id)
        .first()
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found.")

    if payload.watch_status is not None:
        video.watch_status = payload.watch_status.strip().replace(" ", "_").upper()

    if payload.status is not None:
        norm = payload.status.strip().replace(" ", "_").upper()
        if norm in ["TO_DO", "DOING", "DONE"]:
            video.watch_status = norm
        else:
            video.status = norm

    if payload.chatgpt_link is not None:
        video.chatgpt_link = payload.chatgpt_link.strip() if payload.chatgpt_link else None

    if payload.channel_tags is not None:
        tags = [t.strip().lstrip("#").lower() for t in payload.channel_tags.split(",") if t.strip()]
        tags_str = ", ".join(tags) if tags else None
        video.channel_tags = tags_str
        if video.channel_title:
            db.query(Video).filter(
                Video.user_id == current_user.id,
                Video.channel_title == video.channel_title
            ).update({"channel_tags": tags_str})
            db.query(ChannelTag).filter(
                ChannelTag.user_id == current_user.id,
                ChannelTag.channel_title == video.channel_title
            ).delete()
            for t in tags:
                db.add(ChannelTag(user_id=current_user.id, channel_title=video.channel_title, tag=t))

    if payload.channel_tags is not None and video.channel_title:
        for changed in db.query(Video).filter(Video.user_id == current_user.id, Video.channel_title == video.channel_title).all():
            enqueue_sync(db, changed)
    db.commit()
    db.refresh(video)

    if payload.channel_tags is not None and video.channel_title:
        updated_video_ids = db.query(Video.id).filter(
            Video.user_id == current_user.id, Video.channel_title == video.channel_title
        ).all()
        for (updated_video_id,) in updated_video_ids:
            sync_video_async(updated_video_id)
    else:
        sync_video_async(video.id)

    return VideoRead.model_validate(video)


@router.delete("/{video_db_id}")
def delete_video(
    video_db_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Delete a video record from the library without deleting the Google Drive file (AC7).
    Scoped strictly to the authenticated user.
    """
    video = (
        db.query(Video)
        .filter(Video.id == video_db_id, Video.user_id == current_user.id)
        .first()
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found.")

    db.delete(video)
    db.commit()

    return {"message": "Video removed from library successfully"}
