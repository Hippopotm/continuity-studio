import asyncio
import hashlib
import json
import os
from pathlib import Path
from .database import update_run
from .models import RunRequest


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

        # Genblaze packages deliberately load only for live runs. Provider class
        # names can vary across plugin releases; keep this adapter version-pinned.
        from genblaze_core import Pipeline, Modality, ObjectStorageSink, KeyStrategy
        from genblaze_s3 import S3StorageBackend
        from genblaze_gmicloud import GMICloudProvider

        os.environ["GMI_CLOUD_API_KEY"] = request.connection.provider_api_key.get_secret_value()
        os.environ["B2_KEY_ID"] = request.connection.b2_key_id.get_secret_value()
        os.environ["B2_APP_KEY"] = request.connection.b2_app_key.get_secret_value()

        sink = ObjectStorageSink(
            S3StorageBackend.for_backblaze(request.connection.b2_bucket),
            key_strategy=KeyStrategy.HIERARCHICAL,
        )
        provider = GMICloudProvider()
        prompt = canonical
        update_run(run_id, "generating")

        def run_pipeline():
            return (Pipeline(f"continuity-{request.project_id}-{request.shot_id}")
                .step(provider, model=request.model, prompt=prompt,
                      modality=Modality.VIDEO,
                      reference_images=request.reference_urls,
                      start_image=request.previous_clean_frame_url)
                .run(sink=sink))

        result = await asyncio.to_thread(run_pipeline)
        assets = [{"url": a.url, "sha256": a.sha256} for s in result.run.steps for a in s.assets]
        update_run(run_id, "complete", {
            "mode": "live", "spec_hash": spec_hash, "continuity_score": None,
            "assets": assets, "manifest_hash": result.manifest.canonical_hash,
        })
    except Exception as exc:
        update_run(run_id, "failed", error=str(exc))
