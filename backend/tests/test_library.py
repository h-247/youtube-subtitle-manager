from unittest.mock import patch
from fastapi import status
from app.models.video import Video


def test_ingest_single_video_and_duplicate_detection(client, user_a, user_a_headers):
    # Mock YouTube extraction and subtitle download
    mock_extracted = [{
        "video_id": "testVid123",
        "title": "First Test Video",
        "channel_title": "Test Channel",
        "duration": 120,
        "thumbnail_url": "https://img.test/1.jpg",
        "youtube_url": "https://www.youtube.com/watch?v=testVid123",
    }]
    mock_sub_res = {
        "status": "COMPLETED",
        "subtitle_type": "MANUAL",
        "subtitle_language": "en",
        "file_path": None,
        "error_message": None,
    }

    with patch("app.api.videos.extract_items_from_url", return_value=mock_extracted), \
         patch("app.api.videos.download_subtitles", return_value=mock_sub_res):

        # First ingestion -> newly processed
        res1 = client.post(
            "/api/videos/ingest",
            json={"url": "https://www.youtube.com/watch?v=testVid123"},
            headers=user_a_headers,
        )
        assert res1.status_code == status.HTTP_200_OK
        data1 = res1.json()
        assert data1["total_found"] == 1
        assert data1["processed"] == 1
        assert data1["skipped_duplicates"] == 0
        assert data1["results"][0]["is_duplicate"] is False
        assert data1["results"][0]["video_id"] == "testVid123"

        # Second ingestion by same user -> duplicate detected!
        res2 = client.post(
            "/api/videos/ingest",
            json={"url": "https://www.youtube.com/watch?v=testVid123"},
            headers=user_a_headers,
        )
        assert res2.status_code == status.HTTP_200_OK
        data2 = res2.json()
        assert data2["total_found"] == 1
        assert data2["processed"] == 0
        assert data2["skipped_duplicates"] == 1
        assert data2["results"][0]["is_duplicate"] is True


def test_ingest_playlist_with_duplicates(client, user_a, user_a_headers):
    mock_extracted = [
        {
            "video_id": "playlistVid1",
            "title": "Track 1",
            "channel_title": "Artist",
            "duration": 100,
            "thumbnail_url": "https://img.test/p1.jpg",
            "youtube_url": "https://www.youtube.com/watch?v=playlistVid1",
        },
        {
            "video_id": "playlistVid2",
            "title": "Track 2",
            "channel_title": "Artist",
            "duration": 200,
            "thumbnail_url": "https://img.test/p2.jpg",
            "youtube_url": "https://www.youtube.com/watch?v=playlistVid2",
        },
    ]
    mock_sub_res = {
        "status": "COMPLETED",
        "subtitle_type": "AUTO",
        "subtitle_language": "en",
        "file_path": None,
        "error_message": None,
    }

    with patch("app.api.videos.extract_items_from_url", return_value=mock_extracted), \
         patch("app.api.videos.download_subtitles", return_value=mock_sub_res):

        # Ingest both tracks
        res = client.post(
            "/api/videos/ingest",
            json={"url": "https://www.youtube.com/playlist?list=PLxyz"},
            headers=user_a_headers,
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.json()["total_found"] == 2
        assert res.json()["processed"] == 2

        # Re-ingesting same playlist should report both as duplicates
        res_dup = client.post(
            "/api/videos/ingest",
            json={"url": "https://www.youtube.com/playlist?list=PLxyz"},
            headers=user_a_headers,
        )
        assert res_dup.status_code == status.HTTP_200_OK
        assert res_dup.json()["skipped_duplicates"] == 2
        assert res_dup.json()["processed"] == 0


def test_library_search_and_filter(client, db_session, user_a, user_a_headers):
    # Seed 3 videos for user_a
    v1 = Video(
        user_id=user_a.id,
        video_id="search1",
        youtube_url="https://youtube.com/watch?v=search1",
        title="Python FastAPI Tutorial",
        channel_title="Tech Lead",
        status="COMPLETED",
        subtitle_type="MANUAL",
    )
    v2 = Video(
        user_id=user_a.id,
        video_id="search2",
        youtube_url="https://youtube.com/watch?v=search2",
        title="Next.js App Router Guide",
        channel_title="Frontend Guru",
        status="NO_SUBTITLES",
        subtitle_type="NONE",
    )
    v3 = Video(
        user_id=user_a.id,
        video_id="search3",
        youtube_url="https://youtube.com/watch?v=search3",
        title="Docker Container Masterclass",
        channel_title="DevOps Pro",
        status="FAILED",
        subtitle_type="NONE",
    )
    db_session.add_all([v1, v2, v3])
    db_session.commit()

    # 1. Search by title "FastAPI"
    res_search = client.get("/api/videos?search=FastAPI", headers=user_a_headers)
    assert res_search.status_code == status.HTTP_200_OK
    items = res_search.json()["items"]
    assert len(items) == 1
    assert items[0]["video_id"] == "search1"

    # 2. Search by channel "DevOps"
    res_channel = client.get("/api/videos?search=DevOps", headers=user_a_headers)
    assert res_channel.status_code == status.HTTP_200_OK
    items = res_channel.json()["items"]
    assert len(items) == 1
    assert items[0]["video_id"] == "search3"

    # 3. Filter by status "NO_SUBTITLES"
    res_status = client.get("/api/videos?status=NO_SUBTITLES", headers=user_a_headers)
    assert res_status.status_code == status.HTTP_200_OK
    items = res_status.json()["items"]
    assert len(items) == 1
    assert items[0]["video_id"] == "search2"

    # 4. Search with no matches
    res_none = client.get("/api/videos?search=NonExistentQuery999", headers=user_a_headers)
    assert res_none.status_code == status.HTTP_200_OK
    assert len(res_none.json()["items"]) == 0


def test_edit_status_and_chatgpt_link(client, db_session, user_a, user_a_headers):
    v = Video(
        user_id=user_a.id,
        video_id="editMe1",
        youtube_url="https://youtube.com/watch?v=editMe1",
        title="Editable Video",
        status="PENDING",
        subtitle_type="NONE",
    )
    db_session.add(v)
    db_session.commit()
    db_session.refresh(v)

    # Update status and ChatGPT link
    res_patch = client.patch(
        f"/api/videos/{v.id}",
        json={
            "status": "COMPLETED",
            "chatgpt_link": "https://chatgpt.com/c/6700-1122-3344",
        },
        headers=user_a_headers,
    )
    assert res_patch.status_code == status.HTTP_200_OK
    data = res_patch.json()
    assert data["status"] == "COMPLETED"
    assert data["chatgpt_link"] == "https://chatgpt.com/c/6700-1122-3344"

    # Verify directly in DB
    db_session.refresh(v)
    assert v.status == "COMPLETED"
    assert v.chatgpt_link == "https://chatgpt.com/c/6700-1122-3344"


def test_delete_video_without_drive_deletion(client, db_session, user_a, user_a_headers):
    v = Video(
        user_id=user_a.id,
        video_id="deleteMe1",
        youtube_url="https://youtube.com/watch?v=deleteMe1",
        title="Video To Delete",
        status="COMPLETED",
        drive_file_id="permanent-drive-id-1234",
        drive_file_url="https://drive.google.com/file/d/permanent-drive-id-1234/view",
    )
    db_session.add(v)
    db_session.commit()
    v_id = v.id

    # Ensure Google Drive API is NEVER called during video deletion
    with patch("app.services.drive_service.GoogleDriveService.upload_subtitle") as mock_drive:
        res_del = client.delete(f"/api/videos/{v_id}", headers=user_a_headers)
        assert res_del.status_code == status.HTTP_200_OK
        assert mock_drive.call_count == 0

    # Video is deleted from DB
    deleted = db_session.query(Video).filter(Video.id == v_id).first()
    assert deleted is None


def test_ingest_reprocesses_429_failed_video_on_resubmission(client, db_session, user_a, user_a_headers):
    mock_extracted = [{
        "video_id": "vid429Retry",
        "title": "429 Test Video",
        "channel_title": "Test Channel",
        "duration": 60,
        "thumbnail_url": "https://img.test/429.jpg",
        "youtube_url": "https://www.youtube.com/watch?v=vid429Retry",
    }]
    mock_success = {
        "status": "COMPLETED",
        "subtitle_type": "MANUAL",
        "subtitle_language": "en",
        "file_path": None,
        "error_message": None,
    }

    # Seed an existing video in FAILED status due to 429
    failed_v = Video(
        user_id=user_a.id,
        video_id="vid429Retry",
        youtube_url="https://www.youtube.com/watch?v=vid429Retry",
        title="429 Test Video",
        status="FAILED",
        subtitle_type="NONE",
        error_message="YouTube is temporarily rate limiting subtitle requests (HTTP 429: Too Many Requests). Please wait a few minutes before retrying.",
    )
    db_session.add(failed_v)
    db_session.commit()
    db_session.refresh(failed_v)
    original_db_id = failed_v.id

    # Resubmission by the same user reprocesses the existing record instead of reporting duplicate
    with patch("app.api.videos.extract_items_from_url", return_value=mock_extracted), \
         patch("app.services.ingestion_service.download_subtitles", return_value=mock_success):
        res = client.post(
            "/api/videos/ingest",
            json={"url": "https://www.youtube.com/watch?v=vid429Retry"},
            headers=user_a_headers,
        )
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["total_found"] == 1
        assert data["processed"] == 1
        assert data["skipped_duplicates"] == 0
        assert data["results"][0]["is_duplicate"] is False
        assert data["results"][0]["status"] == "PROCESSING"

    # Verify DB record was updated in-place without violating uniqueness
    db_session.refresh(failed_v)
    assert failed_v.id == original_db_id
    assert failed_v.status == "PROCESSING"

    # Subsequent submission while PROCESSING is treated as duplicate
    with patch("app.api.videos.extract_items_from_url", return_value=mock_extracted):
        res_dup = client.post(
            "/api/videos/ingest",
            json={"url": "https://www.youtube.com/watch?v=vid429Retry"},
            headers=user_a_headers,
        )
        assert res_dup.status_code == status.HTTP_200_OK
        data_dup = res_dup.json()
        assert data_dup["skipped_duplicates"] == 1
        assert data_dup["processed"] == 0
        assert data_dup["results"][0]["is_duplicate"] is True


def test_ingest_reprocesses_failed_and_no_subtitles_video_on_resubmission(client, db_session, user_a, user_a_headers):
    # 1. Seed a video for user_a that failed with a non-429 error (e.g. 403 Forbidden)
    failed_video = Video(
        user_id=user_a.id,
        video_id="vidNon429Fail",
        youtube_url="https://youtube.com/watch?v=vidNon429Fail",
        title="Forbidden Video",
        status="FAILED",
        subtitle_type="NONE",
        error_message="YouTube connection error: 403 Forbidden",
    )
    # 2. Seed a video for user_a that previously had NO_SUBTITLES
    no_sub_video = Video(
        user_id=user_a.id,
        video_id="vidNoSubsPrev",
        youtube_url="https://youtube.com/watch?v=vidNoSubsPrev",
        title="No Subs Video",
        status="NO_SUBTITLES",
        subtitle_type="NONE",
        error_message=None,
    )
    db_session.add_all([failed_video, no_sub_video])
    db_session.commit()

    mock_extracted_failed = [{
        "video_id": "vidNon429Fail",
        "title": "Forbidden Video",
        "channel_title": "Test Channel",
        "duration": 60,
        "thumbnail_url": "https://img.test/403.jpg",
        "youtube_url": "https://youtube.com/watch?v=vidNon429Fail",
    }]
    mock_extracted_nosub = [{
        "video_id": "vidNoSubsPrev",
        "title": "No Subs Video",
        "channel_title": "Test Channel",
        "duration": 90,
        "thumbnail_url": "https://img.test/nosub.jpg",
        "youtube_url": "https://youtube.com/watch?v=vidNoSubsPrev",
    }]

    with patch("app.api.videos.extract_items_from_url", return_value=mock_extracted_failed), \
         patch("app.api.videos.queue_video_processing") as mock_queue:
        res = client.post(
            "/api/videos/ingest",
            json={"url": "https://youtube.com/watch?v=vidNon429Fail"},
            headers=user_a_headers,
        )
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["skipped_duplicates"] == 0
        assert data["processed"] == 1
        assert data["results"][0]["is_duplicate"] is False
        assert data["results"][0]["status"] == "PROCESSING"
        assert mock_queue.call_count == 1

    db_session.refresh(failed_video)
    assert failed_video.status == "PROCESSING"
    assert failed_video.retry_count == 0

    with patch("app.api.videos.extract_items_from_url", return_value=mock_extracted_nosub), \
         patch("app.api.videos.queue_video_processing") as mock_queue:
        res_no = client.post(
            "/api/videos/ingest",
            json={"url": "https://youtube.com/watch?v=vidNoSubsPrev"},
            headers=user_a_headers,
        )
        assert res_no.status_code == status.HTTP_200_OK
        data_no = res_no.json()
        assert data_no["skipped_duplicates"] == 0
        assert data_no["processed"] == 1
        assert data_no["results"][0]["is_duplicate"] is False
        assert data_no["results"][0]["status"] == "PROCESSING"
        assert mock_queue.call_count == 1

    db_session.refresh(no_sub_video)
    assert no_sub_video.status == "PROCESSING"
    assert no_sub_video.retry_count == 0


def test_ingest_preserves_user_isolation_with_429_failures(client, db_session, user_a, user_a_headers, user_b, user_b_headers):
    # User A has a 429 failed record
    v_a = Video(
        user_id=user_a.id,
        video_id="sharedVid429",
        youtube_url="https://youtube.com/watch?v=sharedVid429",
        title="Rate-Limited Video",
        status="FAILED",
        subtitle_type="NONE",
        error_message="YouTube is temporarily rate limiting subtitle requests (HTTP 429: Too Many Requests). Please wait a few minutes before retrying.",
    )
    db_session.add(v_a)
    db_session.commit()

    mock_extracted = [{
        "video_id": "sharedVid429",
        "title": "Rate-Limited Video",
        "channel_title": "Test Channel",
        "duration": 60,
        "thumbnail_url": "https://img.test/rate.jpg",
        "youtube_url": "https://youtube.com/watch?v=sharedVid429",
    }]

    # User B ingests the same video ID -> creates User B's own record in PROCESSING state
    with patch("app.api.videos.extract_items_from_url", return_value=mock_extracted):
        res_b = client.post(
            "/api/videos/ingest",
            json={"url": "https://youtube.com/watch?v=sharedVid429"},
            headers=user_b_headers,
        )
        assert res_b.status_code == status.HTTP_200_OK
        data_b = res_b.json()
        assert data_b["processed"] == 1
        assert data_b["skipped_duplicates"] == 0
        assert data_b["results"][0]["is_duplicate"] is False
        assert data_b["results"][0]["status"] == "PROCESSING"

    # Check both records in DB
    db_session.refresh(v_a)
    assert v_a.status == "FAILED"  # User A's record was untouched!

    v_b = db_session.query(Video).filter(Video.user_id == user_b.id, Video.video_id == "sharedVid429").first()
    assert v_b is not None
    assert v_b.status == "PROCESSING"
    assert v_b.id != v_a.id


def test_async_worker_retry_and_success_flow(db_session, user_a):
    import time
    from app.services.ingestion_service import _process_video_worker
    from app.models.video import Video

    video = Video(
        user_id=user_a.id,
        video_id="workerTest1",
        youtube_url="https://youtube.com/watch?v=workerTest1",
        title="Worker Test Video",
        status="PROCESSING",
        subtitle_type="NONE",
        retry_count=0,
        progress_message="Queued for processing...",
    )
    db_session.add(video)
    db_session.commit()
    db_session.refresh(video)
    vid_id = video.id

    call_count = 0
    def mock_download(video_id, url):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # First attempt: lack of English subtitles
            return {
                "status": "NO_SUBTITLES",
                "subtitle_type": "NONE",
                "subtitle_language": None,
                "file_path": None,
                "error_message": None,
            }
        elif call_count == 2:
            # Second attempt: transient network / 429 failure
            return {
                "status": "FAILED",
                "subtitle_type": "NONE",
                "subtitle_language": None,
                "file_path": None,
                "error_message": "Network error",
            }
        else:
            # Third attempt: success
            return {
                "status": "COMPLETED",
                "subtitle_type": "MANUAL",
                "subtitle_language": "en",
                "file_path": None,
                "error_message": None,
            }

    from contextlib import contextmanager

    @contextmanager
    def mock_get_db_session():
        yield db_session

    with patch("app.services.ingestion_service.get_db_session", side_effect=mock_get_db_session), \
         patch("app.services.ingestion_service.download_subtitles", side_effect=mock_download), \
         patch("app.services.ingestion_service.time.sleep", return_value=None):
        _process_video_worker(vid_id, user_a.id, initial_delay=0.0)

    db_session.refresh(video)
    assert video.status == "COMPLETED"
    assert video.subtitle_type == "MANUAL"
    assert video.subtitle_language == "en"
    assert video.retry_count == 2
    assert "Subtitles downloaded and archived successfully" in video.progress_message
    assert video.error_message is None


def test_invalid_url_rejected_before_job_queued(client, user_a_headers):
    # Reject empty URL
    res_empty = client.post("/api/videos/ingest", json={"url": "   "}, headers=user_a_headers)
    assert res_empty.status_code == status.HTTP_400_BAD_REQUEST

    # Reject unparseable URL
    with patch("app.api.videos.extract_items_from_url", return_value=[]):
        res_invalid = client.post(
            "/api/videos/ingest",
            json={"url": "https://not-youtube.com/invalid"},
            headers=user_a_headers,
        )
        assert res_invalid.status_code == status.HTTP_400_BAD_REQUEST


def test_concurrent_job_prevention_on_same_video(client, db_session, user_a, user_a_headers):
    from app.services.ingestion_service import is_job_active

    v = Video(
        user_id=user_a.id,
        video_id="concurrentVid1",
        youtube_url="https://youtube.com/watch?v=concurrentVid1",
        title="Concurrent Job Test",
        status="PROCESSING",
        subtitle_type="NONE",
        retry_count=1,
        progress_message="Retrying (attempt 1)...",
    )
    db_session.add(v)
    db_session.commit()
    db_session.refresh(v)

    mock_extracted = [{
        "video_id": "concurrentVid1",
        "title": "Concurrent Job Test",
        "channel_title": "Test Channel",
        "duration": 60,
        "thumbnail_url": "https://img.test/c.jpg",
        "youtube_url": "https://youtube.com/watch?v=concurrentVid1",
    }]

    with patch("app.api.videos.extract_items_from_url", return_value=mock_extracted), \
         patch("app.api.videos.queue_video_processing") as mock_queue:
        res = client.post(
            "/api/videos/ingest",
            json={"url": "https://youtube.com/watch?v=concurrentVid1"},
            headers=user_a_headers,
        )
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["skipped_duplicates"] == 1
        assert data["processed"] == 0
        assert mock_queue.call_count == 0


def test_async_worker_drive_upload_failure_retries_and_succeeds(db_session, user_a):
    import json
    from app.services.ingestion_service import _process_video_worker
    from app.models.video import Video
    from contextlib import contextmanager

    user_a.drive_credentials = json.dumps({"token": "fake-token", "refresh_token": "fake-refresh"})
    db_session.commit()

    video = Video(
        user_id=user_a.id,
        video_id="driveRetry1",
        youtube_url="https://youtube.com/watch?v=driveRetry1",
        title="Drive Retry Test",
        status="PROCESSING",
        subtitle_type="NONE",
        retry_count=0,
        progress_message="Queued for processing...",
    )
    db_session.add(video)
    db_session.commit()
    db_session.refresh(video)
    vid_id = video.id

    mock_sub = {
        "status": "COMPLETED",
        "subtitle_type": "MANUAL",
        "subtitle_language": "en",
        "file_path": "fake_path.vtt",
        "error_message": None,
    }

    drive_attempts = 0
    def mock_upload(file_path, title, credentials_data, delete_on_success):
        nonlocal drive_attempts
        drive_attempts += 1
        if drive_attempts == 1:
            raise RuntimeError("Temporary Google Drive 500 API error")
        return {
            "drive_file_id": "uploaded-drive-123",
            "drive_file_url": "https://drive.google.com/file/d/uploaded-drive-123/view",
        }

    @contextmanager
    def mock_get_db_session():
        yield db_session

    with patch("app.services.ingestion_service.get_db_session", side_effect=mock_get_db_session), \
         patch("app.services.ingestion_service.download_subtitles", return_value=mock_sub), \
         patch("app.services.ingestion_service.drive_service.upload_subtitle", side_effect=mock_upload), \
         patch("app.services.ingestion_service.time.sleep", return_value=None):
        _process_video_worker(vid_id, user_a.id, initial_delay=0.0)

    db_session.refresh(video)
    assert video.status == "COMPLETED"
    assert video.drive_file_id == "uploaded-drive-123"
    assert video.retry_count == 1
    assert "Subtitles downloaded and archived successfully" in video.progress_message


def test_library_list_returns_persisted_progress_and_retry_count(client, db_session, user_a, user_a_headers):
    v = Video(
        user_id=user_a.id,
        video_id="progressList1",
        youtube_url="https://youtube.com/watch?v=progressList1",
        title="Processing Video in Library",
        status="PROCESSING",
        subtitle_type="NONE",
        retry_count=3,
        progress_message="Retrying subtitle download (attempt 4)...",
        error_message="Subtitle download failed",
    )
    db_session.add(v)
    db_session.commit()

    res = client.get("/api/videos", headers=user_a_headers)
    assert res.status_code == status.HTTP_200_OK
    items = res.json()["items"]
    target = next((item for item in items if item["video_id"] == "progressList1"), None)
    assert target is not None
    assert target["status"] == "PROCESSING"
    assert target["retry_count"] == 3
    assert target["progress_message"] == "Retrying subtitle download (attempt 4)..."
    assert target["error_message"] == "Subtitle download failed"


def test_watch_status_filter_and_update(client, db_session, user_a, user_a_headers):
    v1 = Video(
        user_id=user_a.id,
        video_id="wsVid1",
        youtube_url="https://youtube.com/watch?v=wsVid1",
        title="Python Basics",
        status="COMPLETED",
        watch_status="TO_DO",
    )
    v2 = Video(
        user_id=user_a.id,
        video_id="wsVid2",
        youtube_url="https://youtube.com/watch?v=wsVid2",
        title="Python Advanced",
        status="COMPLETED",
        watch_status="DOING",
    )
    db_session.add_all([v1, v2])
    db_session.commit()

    # Filter by watch_status=DOING
    res = client.get("/api/videos?watch_status=DOING", headers=user_a_headers)
    assert res.status_code == status.HTTP_200_OK
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["video_id"] == "wsVid2"

    # Update v1 watch_status to DONE
    res_patch = client.patch(
        f"/api/videos/{v1.id}",
        json={"watch_status": "DONE"},
        headers=user_a_headers,
    )
    assert res_patch.status_code == status.HTTP_200_OK
    assert res_patch.json()["watch_status"] == "DONE"
    # Ensure subtitle status remains COMPLETED
    assert res_patch.json()["status"] == "COMPLETED"


def test_channel_tags_and_filter_by_tag(client, db_session, user_a, user_a_headers):
    v1 = Video(
        user_id=user_a.id,
        video_id="tagVid1",
        youtube_url="https://youtube.com/watch?v=tagVid1",
        title="English Lesson 1",
        channel_title="BBC English",
        status="COMPLETED",
        channel_tags="en",
    )
    v2 = Video(
        user_id=user_a.id,
        video_id="tagVid2",
        youtube_url="https://youtube.com/watch?v=tagVid2",
        title="JavaScript Async",
        channel_title="Traversy Media",
        status="COMPLETED",
        channel_tags="it",
    )
    db_session.add_all([v1, v2])
    db_session.commit()

    # Get all tags for user
    res_tags = client.get("/api/videos/tags", headers=user_a_headers)
    assert res_tags.status_code == status.HTTP_200_OK
    tags = res_tags.json()
    assert "en" in tags
    assert "it" in tags

    # Filter by tag=en
    res_en = client.get("/api/videos?tag=en", headers=user_a_headers)
    assert res_en.status_code == status.HTTP_200_OK
    assert len(res_en.json()["items"]) == 1
    assert res_en.json()["items"][0]["video_id"] == "tagVid1"

    # Set new tags for channel "BBC English" -> "en, ss"
    res_set = client.post(
        "/api/videos/channel-tags",
        json={"channel_title": "BBC English", "tags": "en, ss"},
        headers=user_a_headers,
    )
    assert res_set.status_code == status.HTTP_200_OK
    assert res_set.json()["tags"] == ["en", "ss"]

    # Filter by tag=ss
    res_ss = client.get("/api/videos?tag=ss", headers=user_a_headers)
    assert res_ss.status_code == status.HTTP_200_OK
    assert len(res_ss.json()["items"]) == 1
    assert res_ss.json()["items"][0]["video_id"] == "tagVid1"

    # Test list channels
    res_channels = client.get("/api/videos/channels", headers=user_a_headers)
    assert res_channels.status_code == status.HTTP_200_OK
    channels = res_channels.json()
    assert len(channels) == 2
    # Verify channel details
    bbc_ch = next(c for c in channels if c["channel_title"] == "BBC English")
    assert bbc_ch["video_count"] == 1
    assert "en" in bbc_ch["tags"]
    assert "ss" in bbc_ch["tags"]


