"""Real API/dispatcher for browser tests; only YouTube network work is replaced."""
import os
import sys
import tempfile
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
workspace = tempfile.TemporaryDirectory(prefix="subtitle-e2e-")
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(workspace.name) / "e2e.db")
os.environ["SECRET_KEY"] = "e2e-only-secret-key-at-least-32-characters"
from app.api import videos
from app.services import ingestion_service
from app.main import app

def metadata(url):
    if "/playlist?" in url:
        return [{"video_id": vid, "youtube_url": "https://youtu.be/"+vid, "title": title, "channel_title": "Test Channel", "playlist_title": "English, AI & Learning", "playlist_item_id":"item-"+vid} for vid, title in [("abcdefghijk", "Browser fixture"), ("bcdefghijkl", "Playlist fixture")]]
    return [{"video_id": "abcdefghijk", "youtube_url": url, "title": "Browser fixture", "channel_title": "Test Channel"}]

def subtitles(*args):
    time.sleep(3)
    path = Path(workspace.name) / "subtitle.txt"
    path.write_text("Browser subtitle fixture", encoding="utf-8")
    return {"status": "COMPLETED", "file_path": str(path), "subtitle_type": "MANUAL", "subtitle_language": "en"}

videos.extract_items_from_url = metadata
videos.fetch_managed_playlist = lambda user, playlist_id: metadata("https://www.youtube.com/playlist?list="+playlist_id)
from app.api import youtube
youtube.get_youtube_status = lambda user: {"is_connected":True,"is_configured":True,"connect_url":"https://example.com/connect","jobs":[],"pending_count":0,"removed_count":0,"failed_count":0}
ingestion_service.download_subtitles = subtitles
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=18000)
