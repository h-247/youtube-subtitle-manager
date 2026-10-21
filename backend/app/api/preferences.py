from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.services.sites_sync_service import get_prompt_link, set_prompt_link

router = APIRouter(prefix="/preferences", tags=["preferences"])


class PromptLinkUpdate(BaseModel):
    chatgpt_prompt_link: str | None = None


def normalize_link(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    value = value.strip()
    try:
        parsed = urlsplit(value)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Enter a valid HTTP or HTTPS ChatGPT link.") from error
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=422, detail="Enter a valid HTTP or HTTPS ChatGPT link.")
    return value


@router.get("/prompt-link")
def read_prompt_link(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.sites_sync_token:
        try:
            value = get_prompt_link(current_user.sites_sync_token)
            if value != current_user.chatgpt_prompt_link:
                current_user.chatgpt_prompt_link = value
                db.commit()
        except Exception:
            db.rollback()
    return {"chatgpt_prompt_link": current_user.chatgpt_prompt_link}


@router.patch("/prompt-link")
def write_prompt_link(payload: PromptLinkUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if "chatgpt_prompt_link" not in payload.model_fields_set:
        raise HTTPException(status_code=422, detail="ChatGPT prompt link is required.")
    value = normalize_link(payload.chatgpt_prompt_link)
    if current_user.sites_sync_token:
        try:
            set_prompt_link(current_user.sites_sync_token, value)
        except Exception as error:
            raise HTTPException(status_code=502, detail="Could not update the shared prompt link on Sites.") from error
    current_user.chatgpt_prompt_link = value
    db.commit()
    return {"chatgpt_prompt_link": value}
