import os
import uuid
import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .database import create_run, get_run, initialize
from .models import ConnectionTest, RunCreated, RunRequest
from .orchestrator import execute_run
from .storage import test_b2

app = FastAPI(title="Continuity Media Worker", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=[], allow_methods=["GET", "POST"], allow_headers=["*"])


@app.on_event("startup")
def startup() -> None:
    initialize()


def authorize(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("WORKER_TOKEN")
    if expected and authorization != f"Bearer {expected}":
        raise HTTPException(401, "Invalid worker token")


def owner(x_continuity_user: str = Header(default="anonymous")) -> str:
    return x_continuity_user


def openai_test_headers(connection: ConnectionTest) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {connection.provider_api_key.get_secret_value()}"}
    if connection.openai_project_id:
        headers["OpenAI-Project"] = connection.openai_project_id.strip()
    if connection.openai_organization_id:
        headers["OpenAI-Organization"] = connection.openai_organization_id.strip()
    return headers


@app.get("/health")
def health():
    return {"ok": True, "service": "continuity-media-worker", "version": "0.3.3"}


@app.post("/v1/connections/test", dependencies=[Depends(authorize)])
def test_connection(connection: ConnectionTest):
    try:
        test_b2(connection)
        if connection.provider == "openai":
            response = httpx.get(
                "https://api.openai.com/v1/models/sora-2",
                headers=openai_test_headers(connection),
                timeout=12,
            )
            if response.status_code >= 400:
                detail = response.json().get("error", {}).get("message", "OpenAI rejected this API key")
                raise ValueError(detail)
        elif connection.provider not in {"gmicloud", "openai"}:
            raise ValueError("Choose GMI Cloud or OpenAI; this provider is not enabled yet")
    except Exception as exc:
        raise HTTPException(400, f"Connection failed: {exc}") from exc
    return {"ok": True, "mode": "live", "provider": connection.provider, "bucket": connection.b2_bucket}


@app.post("/v1/runs", response_model=RunCreated, dependencies=[Depends(authorize)])
def start_run(request: RunRequest, background: BackgroundTasks, current_owner: str = Depends(owner)):
    run_id = f"run_{uuid.uuid4().hex}"
    data = request.model_dump(mode="json", exclude={"connection"})
    create_run(run_id, current_owner, data)
    background.add_task(execute_run, run_id, request)
    mode = "live" if request.connection else "demo"
    return RunCreated(id=run_id, status="queued" if mode == "live" else "demo",
                      estimated_cost_usd=min(request.budget_usd, 0.73), mode=mode)


@app.get("/v1/runs/{run_id}", dependencies=[Depends(authorize)])
def read_run(run_id: str, current_owner: str = Depends(owner)):
    run = get_run(run_id, current_owner)
    if not run:
        raise HTTPException(404, "Run not found")
    return run
