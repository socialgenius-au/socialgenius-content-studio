"""Admin-only, read-only view of AI spending and usage. Booleans for configuration (never a key), totals, per-reference and per-reasoner breakdowns and the latest ledger rows
(no prompts, no images, no responses)."""
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.deps import current_user
from app.models.user import User
from app.services.ai_metering import usage_summary

router = APIRouter()


async def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admins only")
    return user


@router.get("/usage")
async def ai_usage(limit: int = Query(50, ge=1, le=200), _: User = Depends(admin_user)):
    return await usage_summary(limit=limit)
