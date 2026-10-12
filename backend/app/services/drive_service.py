import os
import json
import logging
from typing import Optional, Dict, Any, Tuple
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google.auth.transport.requests import Request

from app.config import settings

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
]


class GoogleDriveService:
    """
    Isolated Google Drive OAuth and upload service.
    Handles token management, file uploads, and cleanup of temporary subtitle files
    strictly only after confirmed successful upload.
    """

    def __init__(self):
        self.client_id = settings.GOOGLE_CLIENT_ID
        self.client_secret = settings.GOOGLE_CLIENT_SECRET
        self.redirect_uri = settings.GOOGLE_REDIRECT_URI

    def is_configured(self) -> bool:
        """Returns True if Google Drive client ID and secret are configured."""
        return bool(self.client_id and self.client_secret)

    def get_client_config(self) -> Dict[str, Any]:
        return {
            "web": {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [self.redirect_uri],
            }
        }

    def get_authorization_url(self, state: Optional[str] = None) -> Tuple[str, str]:
        """
        Creates an authorization URL for Google Drive access.
        Returns (auth_url, state).
        """
        if not self.is_configured():
            raise ValueError("Google Drive OAuth is not configured with CLIENT_ID and CLIENT_SECRET.")

        flow = Flow.from_client_config(
            self.get_client_config(),
            scopes=SCOPES,
            redirect_uri=self.redirect_uri,
            autogenerate_code_verifier=False,
        )
        auth_url, state = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state=state,
        )
        return auth_url, state

    def exchange_code_for_tokens(self, code: str) -> Dict[str, Any]:
        """
        Exchanges authorization code for credentials tokens dictionary.
        """
        if not self.is_configured():
            raise ValueError("Google Drive OAuth is not configured.")

        flow = Flow.from_client_config(
            self.get_client_config(),
            scopes=SCOPES,
            redirect_uri=self.redirect_uri,
            autogenerate_code_verifier=False,
        )
        flow.fetch_token(code=code)
        creds = flow.credentials

        return {
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "scopes": creds.scopes,
        }

    def get_service_from_credentials(self, credentials_data: Dict[str, Any]):
        """
        Builds Google Drive API resource from stored user credentials.
        Refreshes token if expired.
        """
        creds = Credentials(
            token=credentials_data.get("token"),
            refresh_token=credentials_data.get("refresh_token"),
            token_uri=credentials_data.get("token_uri", "https://oauth2.googleapis.com/token"),
            client_id=credentials_data.get("client_id") or self.client_id,
            client_secret=credentials_data.get("client_secret") or self.client_secret,
            scopes=credentials_data.get("scopes", SCOPES),
        )

        if creds.expired and creds.refresh_token:
            creds.refresh(Request())

        return build("drive", "v3", credentials=creds, cache_discovery=False)

    def get_or_create_folder(self, service, folder_name: str) -> Optional[str]:
        """Gets or creates the dedicated subtitle folder in Google Drive."""
        try:
            query = f"mimeType = 'application/vnd.google-apps.folder' and name = '{folder_name}' and trashed = false"
            response = service.files().list(q=query, spaces="drive", fields="files(id, name)").execute()
            files = response.get("files", [])
            if files:
                return files[0]["id"]

            file_metadata = {
                "name": folder_name,
                "mimeType": "application/vnd.google-apps.folder",
            }
            folder = service.files().create(body=file_metadata, fields="id").execute()
            return folder.get("id")
        except Exception as e:
            logger.warning(f"Failed to get or create folder '{folder_name}', uploading to root: {e}")
            return None

    def upload_subtitle(
        self,
        file_path: str,
        title: str,
        credentials_data: Dict[str, Any],
        delete_on_success: bool = True,
    ) -> Dict[str, Any]:
        """
        Uploads subtitle file to Google Drive.
        Crucial requirement: deletes temporary subtitle file ONLY after confirmed upload.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Subtitle file does not exist: {file_path}")

        service = self.get_service_from_credentials(credentials_data)
        folder_id = self.get_or_create_folder(service, settings.GOOGLE_DRIVE_FOLDER_NAME)

        base_name = os.path.basename(file_path)
        ext = os.path.splitext(base_name)[1]
        upload_filename = f"{title}{ext}"

        file_metadata: Dict[str, Any] = {
            "name": upload_filename,
        }
        if folder_id:
            file_metadata["parents"] = [folder_id]

        mime_type = "text/vtt" if ext == ".vtt" else "text/plain"
        media = MediaFileUpload(file_path, mimetype=mime_type, resumable=True)

        try:
            # Execute upload
            uploaded_file = (
                service.files()
                .create(body=file_metadata, media_body=media, fields="id, webViewLink, webContentLink")
                .execute()
            )

            file_id = uploaded_file.get("id")
            web_view_link = uploaded_file.get("webViewLink") or f"https://drive.google.com/file/d/{file_id}/view"

            # Close open handle if held by MediaFileUpload (important on Windows)
            if hasattr(media, "_fd") and media._fd and not media._fd.closed:
                try:
                    media._fd.close()
                except Exception:
                    pass

            # Confirmed upload successful -> delete temporary file if requested
            if delete_on_success and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except OSError as rm_err:
                    logger.warning(f"Could not remove temporary file after upload: {rm_err}")

            return {
                "drive_file_id": file_id,
                "drive_file_url": web_view_link,
            }
        except Exception as upload_err:
            if hasattr(media, "_fd") and media._fd and not media._fd.closed:
                try:
                    media._fd.close()
                except Exception:
                    pass
            # On failure, do NOT delete file so local artifact is not lost
            logger.error(f"Failed to upload subtitle file {file_path}: {upload_err}")
            raise upload_err


drive_service = GoogleDriveService()
