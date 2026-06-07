from fastapi import APIRouter, Depends, HTTPException, status

from app.deps import current_user
from app.models.user import User
from app.schemas.publish import (
    BeehiivPublishRequest, BeehiivPublishResponse,
    GMBPublishRequest, GMBPublishResponse,
)
from app.services import beehiiv_svc, gmb_svc

router = APIRouter()


@router.post("/beehiiv", response_model=BeehiivPublishResponse)
async def publish_beehiiv(body: BeehiivPublishRequest, _user: User = Depends(current_user)):
    try:
        return await beehiiv_svc.create_post(
            title=body.title,
            content_html=body.content_html,
            subtitle=body.subtitle,
            status=body.status,
            send_at=body.send_at,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Beehiiv error: {exc}") from exc


@router.post("/gmb", response_model=GMBPublishResponse)
async def publish_gmb(body: GMBPublishRequest, _user: User = Depends(current_user)):
    try:
        return await gmb_svc.create_local_post(
            text=body.text,
            call_to_action_type=body.call_to_action_type,
            call_to_action_url=body.call_to_action_url,
            media_url=body.media_url,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"GMB error: {exc}") from exc
