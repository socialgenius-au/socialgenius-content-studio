from datetime import datetime
from pydantic import BaseModel


class AssetResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    job_id: int | None
    user_id: int
    original_filename: str
    stored_filename: str
    file_path: str
    file_type: str
    mime_type: str
    file_size: int
    created_at: datetime
