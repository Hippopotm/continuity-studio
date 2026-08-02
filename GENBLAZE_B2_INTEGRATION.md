# Genblaze + Backblaze B2 integration handoff

The deployed app uses a separate Python media worker because Genblaze is
Python-first and video jobs should not run inside the web request runtime. The
worker validates BYOK credentials, starts provider jobs, persists outputs to
Backblaze B2, and returns playable presigned URLs.

## Worker contract

The web app submits a locked continuity specification and receives a job id:

```http
POST /v1/runs
Authorization: Bearer <session token>
Content-Type: application/json

{
  "project_id": "last-train",
  "shot_id": "shot-02",
  "provider": "gmicloud",
  "model": "Kling-Image2Video-V2.1-Master",
  "specification": {},
  "reference_urls": [],
  "previous_clean_frame_url": "https://.../clean-end.png",
  "budget_usd": 0.75
}
```

Progress is polled as `queued`, `compiling`, `generating`, `complete`, or
`failed`. A run is marked `complete` only when the worker has a playable
`video/mp4` asset URL. The complete event returns asset URLs, hashes,
continuity scores, provider metadata, and future manifest references.

## Recommended Genblaze shape

Install only the provider packages used by the deployment:

```bash
pip install genblaze genblaze-gmicloud genblaze-openai genblaze-s3
```

Create an `ObjectStorageSink` with
`S3StorageBackend.for_backblaze(bucket_name)` and hierarchical keys. Run the
image-to-video provider with the approved character reference and optional clean
ending frame, then persist the generated clip, extracted clean frame, evaluation
JSON, thumbnail, logs, and Genblaze manifest through that sink.

The current worker uses this Genblaze pipeline for GMI Cloud Kling. OpenAI Sora
generation uses the OpenAI Videos API directly, downloads the resulting MP4,
then stores it in the same Backblaze B2 bucket. This direct path avoids blocking
the product on provider adapter drift while keeping Genblaze as the
orchestration layer for supported provider workflows.

The worker must keep BYOK values in memory or encrypted server-side storage.
Never include credentials in prompts, logs, events, B2 object metadata, or
provenance manifests.

## B2 object layout

```text
projects/{project_id}/
  continuity/active.json
  references/characters/{character_id}/
  references/voices/{character_id}/
  shots/{shot_id}/specification.json
  shots/{shot_id}/candidate-{n}.mp4
  shots/{shot_id}/candidate-{n}-evaluation.json
  shots/{shot_id}/clean-end.png
  renders/final.mp4
  manifests/
  logs/
```

Use lifecycle rules for rejected candidates and previews. Preserve approved
assets and manifests. Cache by a canonical hash of the locked specification,
provider/model parameters, and input-asset hashes so identical requests do not
generate twice.

## Environment variables

```text
B2_KEY_ID=
B2_APP_KEY=
B2_BUCKET=
GMI_CLOUD_API_KEY=
OPENAI_API_KEY=
SESSION_ENCRYPTION_KEY=
```

Provider keys supplied by users should override the service key for that run,
then be discarded when the session ends.
