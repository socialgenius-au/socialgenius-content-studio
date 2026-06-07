from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.limiter import limiter
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse
from app.services.auth import verify_password, create_token
from app.deps import current_user

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    return TokenResponse(
        access_token=create_token(user.id, user.username, user.role),
        user_id=user.id,
        username=user.username,
        role=user.role,
    )


@router.get("/me")
async def me(user: User = Depends(current_user)):
    return {"id": user.id, "username": user.username, "email": user.email, "role": user.role}
