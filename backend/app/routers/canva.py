from fastapi import APIRouter, Depends, HTTPException, status

from app.deps import current_user
from app.models.user import User
from app.schemas.publish import CanvaDesignRequest, CanvaDesignResponse
from app.services import canva_svc

router = APIRouter()


@router.post("/design", response_model=CanvaDesignResponse)
async def create_design(body: CanvaDesignRequest, _user: User = Depends(current_user)):
    try:
        return await canva_svc.create_design(
            title=body.title,
            design_type=body.design_type,
            brand_template_id=body.brand_template_id,
            data=body.data or {},
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Canva error: {exc}") from exc


@router.get("/templates")
async def list_templates(query: str = "", _user: User = Depends(current_user)):
    try:
        return {"templates": await canva_svc.list_brand_templates(query)}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.post("/export/{design_id}")
async def export_design(design_id: str, fmt: str = "png", _user: User = Depends(current_user)):
    try:
        url = await canva_svc.export_design(design_id, fmt)
        return {"design_id": design_id, "format": fmt, "url": url}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Export error: {exc}") from exc
