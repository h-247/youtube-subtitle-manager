from fastapi import status
from app.models.video import Video


def test_cross_user_isolation(client, db_session, user_a, user_a_headers, user_b, user_b_headers):
    # Create video owned by User A
    video_a = Video(
        user_id=user_a.id,
        video_id="videoUserA1",
        youtube_url="https://www.youtube.com/watch?v=videoUserA1",
        title="User A Private Video",
        status="COMPLETED",
        subtitle_type="MANUAL",
        chatgpt_link="https://chatgpt.com/c/original-a",
        drive_file_id="drive-12345",
    )
    db_session.add(video_a)
    db_session.commit()
    db_session.refresh(video_a)

    # 1. User A can list and sees their video
    resp_a = client.get("/api/videos", headers=user_a_headers)
    assert resp_a.status_code == status.HTTP_200_OK
    items_a = resp_a.json()["items"]
    assert len(items_a) == 1
    assert items_a[0]["video_id"] == "videoUserA1"

    # 2. User B lists videos -> gets empty list, CANNOT see User A's video
    resp_b = client.get("/api/videos", headers=user_b_headers)
    assert resp_b.status_code == status.HTTP_200_OK
    items_b = resp_b.json()["items"]
    assert len(items_b) == 0

    # 3. User B cannot access User A's video by ID (404 Not Found)
    resp_b_get = client.get(f"/api/videos/{video_a.id}", headers=user_b_headers)
    assert resp_b_get.status_code == status.HTTP_404_NOT_FOUND

    # 4. User B cannot update User A's video (404 Not Found)
    resp_b_patch = client.patch(
        f"/api/videos/{video_a.id}",
        json={"chatgpt_link": "https://malicious-link.com"},
        headers=user_b_headers,
    )
    assert resp_b_patch.status_code == status.HTTP_404_NOT_FOUND

    # Verify User A's video link was not changed
    db_session.refresh(video_a)
    assert video_a.chatgpt_link == "https://chatgpt.com/c/original-a"

    # 5. User B cannot delete User A's video (404 Not Found)
    resp_b_delete = client.delete(f"/api/videos/{video_a.id}", headers=user_b_headers)
    assert resp_b_delete.status_code == status.HTTP_404_NOT_FOUND

    # Verify User A's video still exists in db
    still_exists = db_session.query(Video).filter(Video.id == video_a.id).first()
    assert still_exists is not None

    # 6. User A can access, edit, and delete their own video
    resp_a_patch = client.patch(
        f"/api/videos/{video_a.id}",
        json={"chatgpt_link": "https://chatgpt.com/c/updated-a"},
        headers=user_a_headers,
    )
    assert resp_a_patch.status_code == status.HTTP_200_OK
    assert resp_a_patch.json()["chatgpt_link"] == "https://chatgpt.com/c/updated-a"

    resp_a_delete = client.delete(f"/api/videos/{video_a.id}", headers=user_a_headers)
    assert resp_a_delete.status_code == status.HTTP_200_OK
