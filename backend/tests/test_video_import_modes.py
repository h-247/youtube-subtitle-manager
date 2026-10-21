from unittest.mock import patch, Mock
from app.models.video import Video
from app.models.channel_tag import ChannelTag

def item(vid, playlist=None):
    return {"video_id": vid, "youtube_url": "https://youtu.be/"+vid, "title": vid, "channel_title": "Shared", "playlist_title": playlist, "playlist_item_id": "item-"+vid}

def test_single_video_tags_do_not_inherit_channel(client, db_session, user_a, user_a_headers):
    db_session.add(ChannelTag(user_id=user_a.id, channel_title="Shared", tag="old-channel")); db_session.commit()
    with patch("app.api.videos.extract_items_from_url", return_value=[item("abcdefghijk")]) as extract:
        response = client.post("/api/videos/ingest", headers=user_a_headers, json={"url": "https://www.youtube.com/watch?v=abcdefghijk&list=PLx", "mode": "video", "tags": ["Chosen", "Chosen"]})
    assert response.status_code == 200
    assert response.json()["results"][0]["video"]["tags"] == ["Chosen"]
    assert "list=" not in extract.call_args.args[0]
    with patch("app.api.videos.extract_items_from_url", return_value=[item("bcdefghijkl")]):
        response = client.post("/api/videos/ingest", headers=user_a_headers, json={"url":"https://youtu.be/bcdefghijkl", "mode":"video", "tags":[]})
    assert response.json()["results"][0]["video"]["tags"] == []

def test_playlist_name_tags_every_video_and_merges_duplicates(client, db_session, user_a, user_a_headers):
    existing = Video(user_id=user_a.id, video_id="abcdefghijk", youtube_url="https://youtu.be/abcdefghijk", title="Existing", channel_title="Shared", status="COMPLETED")
    existing.tags = ["Chosen"]; db_session.add(existing); db_session.commit()
    title = "English, AI & Learning"
    with patch("app.api.videos.fetch_managed_playlist", return_value=[item("abcdefghijk",title),item("bcdefghijkl",title)]) as extract:
        response = client.post("/api/videos/ingest", headers=user_a_headers, json={"url":"https://www.youtube.com/watch?v=abcdefghijk&list=PLx", "mode":"playlist", "tags":["Ignored"]})
    assert response.status_code == 200
    assert response.json()["skipped_duplicates"] == 1
    assert existing.tags == ["Chosen", title]
    assert db_session.query(Video).filter_by(video_id="bcdefghijkl").one().tags == [title]
    assert extract.call_args.args[1] == "PLx"
    assert existing.playlist_items == [{"playlist_id":"PLx", "playlist_item_id":"item-abcdefghijk"}]
    result = client.get("/api/videos", headers=user_a_headers, params={"tag": title}).json()
    assert result["total"] == 2
    assert client.get("/api/videos/tags", headers=user_a_headers).json() == ["Chosen",title]

def test_invalid_modes_and_missing_playlist_name_do_not_import(client, db_session, user_a, user_a_headers):
    assert client.post("/api/videos/ingest", headers=user_a_headers, json={"url":"https://youtu.be/abcdefghijk", "mode":"playlist"}).status_code == 400
    with patch("app.api.videos.fetch_managed_playlist", return_value=[item("abcdefghijk")]):
        assert client.post("/api/videos/ingest", headers=user_a_headers, json={"url":"https://www.youtube.com/playlist?list=PLx", "mode":"playlist"}).status_code == 422
    assert db_session.query(Video).filter_by(user_id=user_a.id).count() == 0
