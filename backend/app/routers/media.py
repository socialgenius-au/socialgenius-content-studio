"""Issues short-lived media tokens to an authenticated user (see app/services/media_access.py)."""
from fastapi import APIRouter, Depends

from app.deps import current_user
from app.models.user import User
from app.services.media_access import create_media_token

router = APIRouter()


@router.post("/token")
async def issue_media_token(user: User = Depends(current_user)):
    token, ttl = create_media_token(user.id)
    return {"token": token, "expires_in": ttl}
