# Continuity Studio

Consistency-first AI video production with user-owned provider credentials,
Genblaze orchestration, and durable Backblaze B2 assets and provenance.

## Product surfaces

- `app/` — creator workspace, locked character bible, shot planner, cost policy,
  provider/B2 connection flow, continuity report, and run submission.
- `media-worker/` — authenticated FastAPI service for BYOK validation, queued
  Genblaze runs, B2 persistence, run state, retries, and provider isolation.
- `GENBLAZE_B2_INTEGRATION.md` — deployment contract and object layout.

The hosted web app safely falls back to an explicitly labeled demo run when no
media worker is configured. It never presents a demo result as live generation.

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
