# Genblaze + Backblaze B2 integration handoff

The deployed prototype deliberately runs without paid API calls. Its `Generate`
interaction is a deterministic demo of the job lifecycle. A production worker
should remain a separate Python service because Genblaze is Python-first.

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
  "previous_clean_frame_url": "b2://.../clean-end.png",
  "budget_usd": 0.75
}
```

Progress is streamed as `queued`, `compiling`, `generating`, `evaluating`,
`persisting`, and `complete`. The complete event returns asset URLs, hashes,
continuity scores, actual cost, and the manifest URL.

## Recommended Genblaze shape

Install only the provider packages used by the deployment:

```bash
pip install genblaze genblaze-gmicloud genblaze-s3
```

Create an `ObjectStorageSink` with
`S3StorageBackend.for_backblaze(bucket_name)` and hierarchical keys. Run the
image-to-video provider with the approved character reference and optional clean
ending frame, then persist the generated clip, extracted clean frame, evaluation
JSON, thumbnail, logs, and Genblaze manifest through that sink.

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
SESSION_ENCRYPTION_KEY=
```

Provider keys supplied by users should override the service key for that run,
then be discarded when the session ends.
