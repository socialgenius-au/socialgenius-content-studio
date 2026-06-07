from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.deps import current_user
from app.models.brand import Brand
from app.models.user import User
from app.schemas.brand import BrandCreate, BrandResponse

router = APIRouter()


@router.get("/", response_model=list[BrandResponse])
async def list_brands(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = await db.execute(
        select(Brand).where(Brand.user_id == user.id).order_by(Brand.created_at.desc())
    )
    return result.scalars().all()


@router.post("/", response_model=BrandResponse, status_code=status.HTTP_201_CREATED)
async def create_brand(
    body: BrandCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    brand = Brand(user_id=user.id, **body.model_dump())
    db.add(brand)
    await db.commit()
    await db.refresh(brand)
    return brand


@router.get("/{brand_id}", response_model=BrandResponse)
async def get_brand(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(Brand).where(Brand.id == brand_id, Brand.user_id == user.id))
    brand = result.scalar_one_or_none()
    if not brand:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Brand not found")
    return brand


@router.put("/{brand_id}", response_model=BrandResponse)
async def update_brand(
    brand_id: int,
    body: BrandCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(Brand).where(Brand.id == brand_id, Brand.user_id == user.id))
    brand = result.scalar_one_or_none()
    if not brand:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Brand not found")

    for field, value in body.model_dump().items():
        setattr(brand, field, value)
    await db.commit()
    await db.refresh(brand)
    return brand


@router.delete("/{brand_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_brand(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(Brand).where(Brand.id == brand_id, Brand.user_id == user.id))
    brand = result.scalar_one_or_none()
    if not brand:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Brand not found")
    await db.delete(brand)
    await db.commit()
