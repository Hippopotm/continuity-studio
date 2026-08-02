# Continuity Studio

Consistency-first AI video production with user-owned provider credentials,
Genblaze orchestration, and durable Backblaze B2 assets and provenance.

Live app: https://continuity-studio-mvp.space-girl-in-love.chatgpt.site/?release=6

Continuity Studio helps creators generate short AI video sequences without
losing the same character between shots. The app turns a scene brief into a
locked continuity specification: face traits, hair, wardrobe, camera, motion,
environment, voice direction, negative prompts, and shot handoff notes. The
media worker sends that package to a video model, stores playable MP4 outputs
in Backblaze B2, and returns presigned URLs to the browser.

## Product surfaces

- `app/` — creator workspace, locked character bible, shot planner, cost policy,
  provider/B2 connection flow, continuity report, and run submission.
- `media-worker/` — authenticated FastAPI service for BYOK validation, queued
  Genblaze/OpenAI runs, B2 persistence, run state, and provider isolation.
- `GENBLAZE_B2_INTEGRATION.md` — provider contract and B2 object layout.
- `DEVPOST_SUBMISSION.md` — copy-ready hackathon submission notes.

The hosted app is configured with a production media worker. If a worker is not
configured in another deployment, the app can fall back to an explicitly labeled
demo mode and never presents a demo result as a live generation.

## Providers and models

- OpenAI — `sora-2` for low-cost 1280x720 video generation.
- GMI Cloud — `Kling-Image2Video-V2.1-Master` through Genblaze for
  reference/image-to-video workflows.

The UI is bring-your-own-key: creators supply their provider key and Backblaze
B2 application key at generation time.

## Backblaze B2 usage

- Verifies the creator's B2 bucket before starting a run.
- Stores generated MP4 outputs under deterministic project/shot keys.
- Returns short-lived presigned playback URLs to the browser.
- Keeps durable media storage separate from the web app and provider account.
- Designed to also store provenance manifests, reference frames, thumbnails,
  clean final frames, logs, and continuity evaluation JSON.

## Genblaze usage

- The worker includes Genblaze, `genblaze-gmicloud`, `genblaze-openai`, and
  `genblaze-s3`.
- GMI Cloud video runs are orchestrated through a Genblaze `Pipeline` with an
  `ObjectStorageSink` backed by Backblaze B2-compatible S3 storage.
- OpenAI Sora runs currently use the OpenAI Videos API directly, then store the
  resulting MP4 in B2; this keeps the product functional while preserving the
  Genblaze provider boundary for GMI Cloud and future providers.

## Web app

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

To enable live jobs, configure these server-side environment variables on the
web deployment:

```text
MEDIA_WORKER_URL=https://your-worker.example.com
MEDIA_WORKER_TOKEN=a-long-random-shared-token
```

The browser calls same-origin routes. Only the server proxy knows the worker
URL and shared token.

## Media worker

```bash
cd media-worker
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8080
```

Or deploy the included Dockerfile to any container platform. The container
includes FFmpeg for final-frame extraction, muxing, thumbnails, and captions.

## Security model

- Provider and B2 secrets use password fields and are submitted over the
  same-origin server proxy.
- The worker accepts requests only with its shared bearer token.
- BYOK values are scoped to a generation request; they are excluded from the
  SQLite run record and must never enter logs or Genblaze manifests.
- The user's verified email is forwarded server-to-server as the run owner.
- Production should terminate TLS at both the web and worker endpoints and use
  a managed secret store for service credentials.

## Production checklist

1. Deploy the worker and confirm `/health`.
2. Set `MEDIA_WORKER_URL` and `MEDIA_WORKER_TOKEN` on the web deployment.
3. Create a B2 bucket and restricted application key.
4. Connect a supported generation provider in the UI.
5. Run one low-cost preview and verify its B2 asset and Genblaze manifest.
6. Add a managed queue and Postgres before running multiple worker replicas;
   SQLite is intended for the first single-instance release.
