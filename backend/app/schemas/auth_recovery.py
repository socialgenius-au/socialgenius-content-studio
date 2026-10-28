from pydantic import BaseModel, Field


class PasswordResetRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=255)       # username or email


class TokenBody(BaseModel):
    token: str = Field(min_length=1, max_length=256)


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)
