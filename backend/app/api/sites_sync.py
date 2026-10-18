from fastapi import APIRouter, Depends, HTTPException
import httpx
from cryptography.fernet import InvalidToken
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.services.sites_sync_service import (
    decrypt_token,
    encrypt_token,
    get_pairing_status,
    get_pairing_identity,
    refresh_drive_links,
    sync_user_async,
)

router = APIRouter(prefix="/sites-sync", tags=["sites-sync"])


class PairRequest(BaseModel):
    token: str = Field(min_length=32, max_length=256)


@router.get("/status")
def get_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    status = {"is_connected": False, "drive_is_configured": False, "drive_is_connected": False}
    if current_user.sites_sync_token:
        try:
            status = get_pairing_status(decrypt_token(current_user.sites_sync_token))
        except Exception:
            pass
    from app.models.sync_operation import SyncOperation
    pending = db.query(SyncOperation).filter(SyncOperation.user_id == current_user.id).all()
    return {**status, "site_url": settings.SITES_SYNC_URL,
            "pending_count": len(pending), "failed_count": sum(bool(op.error) for op in pending),
            "sync_error": next((op.error for op in pending if op.error), None)}


@router.post("/connect")
def connect_sites(payload: PairRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    identity = get_pairing_identity(payload.token)
    if not identity:
        raise HTTPException(status_code=400, detail="Sites pairing code is invalid, revoked, or Sites is unreachable.")
    if current_user.sites_user_id and current_user.sites_user_id != identity["user_id"]:
        raise HTTPException(status_code=409, detail="This local account is linked to a different Sites account.")
    current_user.sites_user_id = identity["user_id"]
    current_user.sites_sync_token = encrypt_token(payload.token)
    db.commit()
    sync_user_async(current_user.id)
    return {"is_connected": True, "message": "Sites connected. Existing local videos are syncing."}


@router.post("/refresh-drive-links")
def refresh_sites_drive_links(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not current_user.sites_sync_token:
        raise HTTPException(status_code=409, detail="Connect Sites first.")
    try:
        updated = refresh_drive_links(db, current_user)
    except (httpx.HTTPError, InvalidToken, ValueError):
        raise HTTPException(status_code=502, detail="Could not refresh Drive links from Sites.")
    return {"updated": updated}


@router.delete("/connect")
def disconnect_sites(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.sites_sync_token = None
    db.commit()
    return {"is_connected": False}
