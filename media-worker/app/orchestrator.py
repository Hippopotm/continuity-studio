import asyncio
import base64
import hashlib
import json
import os
import subprocess
import tempfile
import time
from io import BytesIO
import httpx
from PIL import Image, ImageOps
from .database import update_run
from .models import RunRequest
from .storage import presign_asset, put_asset, resolve_b2_connection


OPENAI_VIDEO_STATUS_URL = "https://api.openai.com/v1/videos"


def openai_headers(request: RunRequest) -> dict[str, str]:
    if not request.connection:
        return {}
    headers = {"Authorization": f"Bearer {request.connection.provider_api_key.get_secret_value()}"}
    if request.connection.openai_project_id:
        headers["OpenAI-Project"] = request.connection.openai_project_id.strip()
    if request.connection.openai_organization_id:
        headers["OpenAI-Organization"] = request.connection.openai_organization_id.strip()
    return headers


def build_video_prompt(request: RunRequest) -> str:
    return (
        "Generate a realistic cinematic video shot from this locked continuity JSON. "
        "Preserve character identity, wardrobe, environment, voice/audio cues, camera, "
        "screen direction, and motion exactly. Avoid animation, illustration, stylized "
        "flat art, identity drift, face changes, wardrobe changes, or impossible motion.\n\n"
        f"{json.dumps(request.specification, sort_keys=True, indent=2)}"
    )


def select_duration(request: RunRequest) -> int:
    shot_duration = request.specification.get("shot", {}).get("duration", 4)
    return min((4, 8, 12), key=lambda value: abs(value - int(shot_duration)))


def normalize_image_bytes(image_bytes: bytes, size: tuple[int, int] = (1280, 720)) -> bytes:
    image = Image.open(BytesIO(image_bytes))
    image = ImageOps.exif_transpose(image).convert("RGB")
    image.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, (8, 18, 20))
    x = (size[0] - image.width) // 2
    y = (size[1] - image.height) // 2
    canvas.paste(image, (x, y))
    output = BytesIO()
    canvas.save(output, format="JPEG", quality=94, optimize=True)
    return output.getvalue()


async def prepare_video_reference(client: httpx.AsyncClient, request: RunRequest) -> str | None:
    """Make any image reference match the requested OpenAI video dimensions.

    OpenAI Sora rejects mismatched reference dimensions with:
    "Inpaint image must match the requested width and height".
    We normalize to 1280x720 and store the prepared reference in B2, then send
    that browser-readable B2 URL to the video endpoint.
    """
    source_url = request.previous_clean_frame_url or (request.reference_urls[0] if request.reference_urls else None)
    if not source_url:
        return None
    response = await client.get(source_url, follow_redirects=True)
    if response.status_code >= 400 or len(response.content) < 256:
        raise ValueError(f"Could not download continuity reference image ({response.status_code})")
    normalized = normalize_image_bytes(response.content)
    digest = hashlib.sha256(normalized).hexdigest()[:12]
    key = f"continuity/{request.project_id}/{request.shot_id}/references/{digest}-1280x720.jpg"
    stored_url = put_asset(request.connection, key, normalized, "image/jpeg")
    return presign_asset(request.connection, stored_url)


async def generate_openai_video(run_id: str, request: RunRequest, spec_hash: str) -> None:
    if not request.connection:
        raise ValueError("A live OpenAI run requires provider and B2 credentials")

    headers = openai_headers(request)
    payload = {
        "model": "sora-2",
        "prompt": build_video_prompt(request),
        "seconds": str(select_duration(request)),
        "size": "1280x720",
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(30, read=60)) as client:
        reference_url = await prepare_video_reference(client, request)
        if reference_url:
            payload["input_reference"] = {"image_url": reference_url}
        create_response = await client.post(OPENAI_VIDEO_STATUS_URL, headers=headers, json=payload)
        if create_response.status_code >= 400:
            raise ValueError(openai_error(create_response, "OpenAI could not start the video job"))

        video = create_response.json()
        video_id = video.get("id")
        if not video_id:
            raise ValueError("OpenAI did not return a video job id")

        deadline = time.monotonic() + 12 * 60
        while time.monotonic() < deadline:
            status_response = await client.get(f"{OPENAI_VIDEO_STATUS_URL}/{video_id}", headers=headers)
            if status_response.status_code >= 400:
                raise ValueError(openai_error(status_response, "OpenAI video status check failed"))
            video = status_response.json()
            status = video.get("status")
            if status == "completed":
                break
            if status == "failed":
                error = video.get("error") or {}
                raise ValueError(error.get("message") or "OpenAI video generation failed")
            await asyncio.sleep(8)
        else:
            raise ValueError("OpenAI video generation is still running after 12 minutes")

        content_response = await client.get(
            f"{OPENAI_VIDEO_STATUS_URL}/{video_id}/content",
            headers=headers,
            params={"variant": "video"},
        )
        if content_response.status_code >= 400:
            raise ValueError(openai_error(content_response, "OpenAI video download failed"))
        video_bytes = content_response.content
        if len(video_bytes) < 1024:
            raise ValueError("OpenAI returned an empty video file")

    key = f"continuity/{request.project_id}/{request.shot_id}/{run_id}.mp4"
    stored_url = put_asset(request.connection, key, video_bytes, "video/mp4")
    browser_url = presign_asset(request.connection, stored_url)
    final_frame = extract_final_frame(video_bytes)
    final_frame_url = None
    final_frame_browser_url = None
    if final_frame:
        frame_key = f"continuity/{request.project_id}/{request.shot_id}/{run_id}-final-frame.jpg"
        final_frame_url = put_asset(request.connection, frame_key, final_frame, "image/jpeg")
        final_frame_browser_url = presign_asset(request.connection, final_frame_url)
    update_run(run_id, "complete", {
        "mode": "live",
        "provider": "openai",
        "provider_video_id": video_id,
        "spec_hash": spec_hash,
        "continuity_score": None,
        "assets": [{
            "url": browser_url,
            "storage_url": stored_url,
            "sha256": hashlib.sha256(video_bytes).hexdigest(),
            "media_type": "video/mp4",
            "bytes": len(video_bytes),
        }, *([{
            "url": final_frame_browser_url,
            "storage_url": final_frame_url,
            "sha256": hashlib.sha256(final_frame).hexdigest(),
            "media_type": "image/jpeg",
            "role": "final_frame",
            "bytes": len(final_frame),
        }] if final_frame and final_frame_url and final_frame_browser_url else [])],
    })


def extract_final_frame(video_bytes: bytes) -> bytes | None:
    with tempfile.TemporaryDirectory() as directory:
        input_path = os.path.join(directory, "input.mp4")
        output_path = os.path.join(directory, "final.jpg")
        with open(input_path, "wb") as file:
            file.write(video_bytes)
        command = [
            "ffmpeg", "-y", "-sseof", "-0.2", "-i", input_path,
            "-frames:v", "1", "-q:v", "2", output_path,
        ]
        completed = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        if completed.returncode != 0 or not os.path.exists(output_path):
            return None
        with open(output_path, "rb") as file:
            return file.read()


def openai_error(response: httpx.Response, fallback: str) -> str:
    try:
        body = response.json()
    except Exception:
        return f"{fallback} ({response.status_code})"
    detail = body.get("error", {}).get("message") or body.get("message") or body.get("detail")
    return f"{detail or fallback} ({response.status_code})"


def decode_data_url(value: str) -> tuple[bytes, str] | None:
    if not value.startswith("data:") or ";base64," not in value:
        return None
    header, encoded = value.split(",", 1)
    content_type = header.removeprefix("data:").split(";", 1)[0] or "image/png"
    return base64.b64decode(encoded), content_type


async def execute_run(run_id: str, request: RunRequest) -> None:
    """Run Genblaze off the request thread and persist its manifest to B2.

    Provider construction is isolated here so model packages can be upgraded
    without changing the API. The demo path is intentionally explicit and is
    never reported as a live generation.
    """
    try:
        update_run(run_id, "compiling")
        canonical = json.dumps(request.specification, sort_keys=True, separators=(",", ":"))
        spec_hash = hashlib.sha256(canonical.encode()).hexdigest()

        if os.getenv("ALLOW_DEMO_MODE", "true").lower() == "true" and not request.connection:
            await asyncio.sleep(1.2)
            update_run(run_id, "complete", {
                "mode": "demo", "spec_hash": spec_hash, "continuity_score": 95,
                "assets": [], "actual_cost_usd": 0,
                "message": "Attach a provider and B2 connection for live generation."
            })
            return

        if not request.connection:
            raise ValueError("A live run requires session-scoped provider and B2 credentials")
        request.connection = resolve_b2_connection(request.connection)

        if request.connection.provider == "openai":
            await generate_openai_video(run_id, request, spec_hash)
            return

        # Genblaze packages deliberately load only for live runs. Provider class
        # names can vary across plugin releases; keep this adapter version-pinned.
        from genblaze_core import Pipeline, Modality, ObjectStorageSink, KeyStrategy
        from genblaze_s3 import S3StorageBackend
        from genblaze_gmicloud import GMICloudVideoProvider

        provider_key = request.connection.provider_api_key.get_secret_value()
        b2_key_id = request.connection.b2_key_id.get_secret_value()
        b2_app_key = request.connection.b2_app_key.get_secret_value()

        sink = ObjectStorageSink(
            S3StorageBackend.for_backblaze(
                request.connection.b2_bucket,
                key_id=b2_key_id,
                app_key=b2_app_key,
            ),
            key_strategy=KeyStrategy.HIERARCHICAL,
        )
        provider_name = request.connection.provider
        if provider_name == "gmicloud":
            provider = GMICloudVideoProvider(api_key=provider_key)
            model = request.model
        else:
            raise ValueError(
                f"{provider_name} video generation is not enabled yet; use GMI Cloud or OpenAI"
            )
        prompt = build_video_prompt(request)
        update_run(run_id, "generating")

        supported_duration = select_duration(request)

        def run_pipeline():
            return (Pipeline(f"continuity-{request.project_id}-{request.shot_id}")
                .step(provider, model=model, prompt=prompt,
                      modality=Modality.VIDEO,
                      seconds=supported_duration,
                      size="1280x720")
                .run(sink=sink))

        result = await asyncio.to_thread(run_pipeline)
        assets = [{
            "url": presign_asset(request.connection, a.url),
            "sha256": a.sha256,
            "media_type": a.media_type,
        } for s in result.run.steps for a in s.assets]
        video_assets = [
            asset for asset in assets
            if asset.get("media_type", "").startswith("video") or asset.get("url", "").lower().split("?")[0].endswith(".mp4")
        ]
        if not video_assets:
            raise ValueError("Provider finished but did not return a playable video asset")
        update_run(run_id, "complete", {
            "mode": "live", "spec_hash": spec_hash, "continuity_score": None,
            "assets": video_assets, "manifest_hash": result.manifest.canonical_hash,
        })
    except Exception as exc:
        update_run(run_id, "failed", error=str(exc))
