from typing import Any, Literal
from pydantic import BaseModel, Field, SecretStr


class ConnectionTest(BaseModel):
    provider: Literal["gmicloud", "openai", "google", "runway", "luma"]
    provider_api_key: SecretStr
    openai_project_id: str | None = None
    openai_organization_id: str | None = None
    b2_key_id: SecretStr
    b2_app_key: SecretStr
    b2_bucket: str
    b2_endpoint: str


class RunRequest(BaseModel):
    project_id: str
    shot_id: str
    provider: str = "gmicloud"
    model: str = "Kling-Image2Video-V2.1-Master"
    specification: dict[str, Any]
    reference_urls: list[str] = Field(default_factory=list)
    previous_clean_frame_url: str | None = None
    budget_usd: float = Field(gt=0, le=100)
    connection: ConnectionTest | None = None


class RunCreated(BaseModel):
    id: str
    status: Literal["queued", "demo"]
    estimated_cost_usd: float
    mode: Literal["live", "demo"]
