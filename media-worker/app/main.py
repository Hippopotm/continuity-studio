import base64
import hashlib
import json
import os
import uuid
import httpx
import subprocess
import tempfile
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .database import create_run, get_run, initialize
from .models import AssembleRequest, CharacterVisualRequest, ConnectionTest, RunCreated, RunRequest
from .orchestrator import execute_run, openai_error
from .storage import presign_asset, put_asset, resolve_b2_connection, test_b2

app = FastAPI(title="Continuity Media Worker", version="0.6.0")
app.add_middleware(CORSMiddleware, allow_origins=[], allow_methods=["GET", "POST"], allow_headers=["*"])


@app.on_event("startup")
def startup() -> None:
    initialize()


def authorize(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("WORKER_TOKEN")
    if expected and authorization and authorization != f"Bearer {expected}":
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
    return {"ok": True, "service": "continuity-media-worker", "version": "0.6.0"}


def refresh_result_asset_urls(result: dict | None, connection: ConnectionTest | None = None) -> dict | None:
    if not result:
        return result
    try:
        if not connection:
            connection = ConnectionTest(provider="openai", provider_api_key="server-managed")
        connection = resolve_b2_connection(connection)
        assets = result.get("assets") or []
        refreshed_assets = []
        for asset in assets:
            item = dict(asset)
            storage_url = item.get("storage_url")
            if storage_url:
                item["url"] = presign_asset(connection, storage_url)
            refreshed_assets.append(item)
        return {**result, "assets": refreshed_assets}
    except Exception:
        return result


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


def decode_data_url(value: str) -> tuple[bytes, str] | None:
    if not value.startswith("data:") or ";base64," not in value:
        return None
    header, encoded = value.split(",", 1)
    content_type = header.removeprefix("data:").split(";", 1)[0] or "image/png"
    return base64.b64decode(encoded), content_type


def image_prompt(role: str, character: dict) -> str:
    description = character.get("description") or ""
    keywords = character.get("locked_keywords_in_order") or []
    keyword_text = ", ".join(keywords) if isinstance(keywords, list) else str(keywords)
    role_guidance = {
        "front": "front-facing portrait, neutral expression, face centered, both ears/cheeks visible",
        "threeQuarter": "three-quarter portrait, same exact person, head turned slightly, natural depth",
        "profile": "side profile portrait, same exact person, precise nose, chin, hairline and facial marks",
        "body": "full-body standing reference, same exact person, full outfit visible from head to shoes",
        "characteristics": "close visual reference of the specific unique traits, face marks, hair texture, accessories, and clothing details",
    }.get(role, role)
    return (
        "Create a photorealistic character reference image for a continuity-locked AI video workflow. "
        "Use a plain neutral studio background, natural 50mm lens look, realistic skin texture, no illustration, no cartoon style. "
        f"Role: {role_guidance}. Character description: {description}. Locked keywords in this exact order: {keyword_text}. "
        "Do not change identity, age, skin tone, hairstyle, body type, wardrobe, or unique characteristics."
    )


@app.post("/v1/character-visuals", dependencies=[Depends(authorize)])
async def create_character_visuals(request: CharacterVisualRequest, current_owner: str = Depends(owner)):
    try:
        connection = resolve_b2_connection(request.connection)
        headers = openai_test_headers(connection)
        references: dict[str, str] = {}
        generated: list[str] = []
        uploaded: list[str] = []
        roles = request.required_roles or ["front", "threeQuarter", "profile", "body", "characteristics"]

        for role, value in request.references.items():
            if not value:
                continue
            decoded = decode_data_url(value)
            if decoded:
                body, content_type = decoded
                ext = "jpg" if "jpeg" in content_type or "jpg" in content_type else "png"
                digest = hashlib.sha256(body).hexdigest()[:12]
                key = f"continuity/{request.project_id}/characters/{role}-{digest}.{ext}"
                stored_url = put_asset(connection, key, body, content_type)
                references[role] = presign_asset(connection, stored_url)
                uploaded.append(role)
            else:
                references[role] = value

        async with httpx.AsyncClient(timeout=httpx.Timeout(30, read=90)) as client:
            for role in roles:
                if references.get(role):
                    continue
                response = await client.post(
                    "https://api.openai.com/v1/images/generations",
                    headers=headers,
                    json={
                        "model": "gpt-image-1",
                        "prompt": image_prompt(role, request.character),
                        "size": "1024x1024",
                    },
                )
                if response.status_code >= 400:
                    raise ValueError(openai_error(response, "OpenAI image generation failed"))
                body = response.json()
                b64 = (body.get("data") or [{}])[0].get("b64_json")
                if not b64:
                    raise ValueError("OpenAI did not return image bytes")
                image_bytes = base64.b64decode(b64)
                key = f"continuity/{request.project_id}/characters/{role}-{uuid.uuid4().hex}.png"
                stored_url = put_asset(connection, key, image_bytes, "image/png")
                references[role] = presign_asset(connection, stored_url)
                generated.append(role)
        manifest = {
            "project_id": request.project_id,
            "owner": current_owner,
            "character": request.character,
            "references": references,
            "generated_roles": generated,
            "uploaded_roles": uploaded,
        }
        manifest_bytes = json.dumps(manifest, indent=2, sort_keys=True).encode()
        manifest_key = f"continuity/{request.project_id}/characters/manifest-{uuid.uuid4().hex}.json"
        manifest_url = put_asset(connection, manifest_key, manifest_bytes, "application/json")
        return {"ok": True, "references": references, "generated_roles": generated, "uploaded_roles": uploaded, "manifest_url": presign_asset(connection, manifest_url)}
    except Exception as exc:
        raise HTTPException(400, f"Character visuals failed: {exc}") from exc


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
    try:
        request_data = run.pop("request", None) or {}
        connection_data = request_data.get("connection")
        connection = ConnectionTest(**connection_data) if connection_data else None
        run["result"] = refresh_result_asset_urls(run.get("result"), connection)
    except Exception:
        pass
    return run
