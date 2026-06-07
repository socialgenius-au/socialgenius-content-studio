from fastapi import APIRouter, Depends, HTTPException, status

from app.deps import current_user
from app.models.user import User
from app.schemas.publish import PixabaySearchResponse
from app.services import pixabay_svc

router = APIRouter()


@router.get("/search", response_model=PixabaySearchResponse)
async def search_images(
    q: str,
    image_type: str = "all",
    per_page: int = 20,
    page: int = 1,
    _user: User = Depends(current_user),
):
    try:
        return await pixabay_svc.search_images(q, image_type=image_type, per_page=per_page, page=page)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.get("/search/videos", response_model=PixabaySearchResponse)
async def search_videos(
    q: str,
    per_page: int = 20,
    page: int = 1,
    _user: User = Depends(current_user),
):
    try:
        return await pixabay_svc.search_videos(q, per_page=per_page, page=page)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
