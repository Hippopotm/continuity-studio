import os
import uuid
import httpx
import subprocess
import tempfile
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .database import create_run, get_run, initialize
from .models import AssembleRequest, ConnectionTest, RunCreated, RunRequest
from .orchestrator import execute_run
from .storage import presign_asset, put_asset, resolve_b2_connection, test_b2

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
    return {"ok": True, "service": "continuity-media-worker", "version": "0.4.0"}


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


@app.post("/v1/assemble", dependencies=[Depends(authorize)])
async def assemble_film(request: AssembleRequest, current_owner: str = Depends(owner)):
    if not request.connection:
        raise HTTPException(400, "Provider connection is required for secure B2 output")
    try:
        connection = resolve_b2_connection(request.connection)
        async with httpx.AsyncClient(timeout=httpx.Timeout(30, read=120)) as client:
            clips = []
            with tempfile.TemporaryDirectory() as directory:
                for index, url in enumerate(request.assets, start=1):
                    response = await client.get(url)
                    if response.status_code >= 400 or len(response.content) < 1024:
                        raise ValueError(f"Could not download shot {index}")
                    clip_path = os.path.join(directory, f"shot-{index:02d}.mp4")
                    normalized_path = os.path.join(directory, f"shot-{index:02d}-norm.mp4")
                    with open(clip_path, "wb") as file:
                        file.write(response.content)
                    normalize = [
                        "ffmpeg", "-y", "-i", clip_path, "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
                        "-r", "24", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", normalized_path,
                    ]
                    completed = subprocess.run(normalize, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                    if completed.returncode != 0:
                        raise ValueError(f"Could not normalize shot {index}")
                    clips.append(normalized_path)
                list_path = os.path.join(directory, "clips.txt")
                with open(list_path, "w", encoding="utf-8") as file:
                    for clip in clips:
                        file.write(f"file '{clip}'\n")
                output_path = os.path.join(directory, "final.mp4")
                command = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_path, "-c", "copy", output_path]
                completed = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                if completed.returncode != 0 or not os.path.exists(output_path):
                    raise ValueError("Could not assemble final film")
                with open(output_path, "rb") as file:
                    final_bytes = file.read()
        key = f"continuity/{request.project_id}/renders/final-{uuid.uuid4().hex}.mp4"
        stored_url = put_asset(connection, key, final_bytes, "video/mp4")
        return {
            "ok": True,
            "owner": current_owner,
            "asset": {
                "url": presign_asset(connection, stored_url),
                "storage_url": stored_url,
                "media_type": "video/mp4",
                "bytes": len(final_bytes),
            },
        }
    except Exception as exc:
        raise HTTPException(400, f"Assembly failed: {exc}") from exc


@app.get("/v1/runs/{run_id}", dependencies=[Depends(authorize)])
def read_run(run_id: str, current_owner: str = Depends(owner)):
    run = get_run(run_id, current_owner)
    if not run:
        raise HTTPException(404, "Run not found")
    return run
