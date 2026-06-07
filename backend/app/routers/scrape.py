from fastapi import APIRouter, Depends, HTTPException, status

from app.deps import current_user
from app.models.user import User
from app.schemas.publish import ApifyRunRequest, ApifyRunResponse
from app.services import apify_svc

router = APIRouter()


@router.post("/", response_model=ApifyRunResponse)
async def run_scraper(body: ApifyRunRequest, _user: User = Depends(current_user)):
    try:
        result = await apify_svc.run_actor(
            actor_id=body.actor_id,
            input_data=body.input,
            timeout_secs=body.timeout_secs,
        )
        return ApifyRunResponse(**result)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Apify error: {exc}") from exc
