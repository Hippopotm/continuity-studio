# Devpost submission draft

## Project name

Continuity Studio

## Tagline

Consistent AI video characters, voices, and shot continuity with Backblaze B2
and Genblaze.

## Working app

https://continuity-studio-mvp.space-girl-in-love.chatgpt.site/?release=6

## GitHub repo

Use the public project repository URL after pushing this repo to GitHub.

If a private repository is used instead, grant contributor access to:
https://github.com/b2genblaze

## What it does

Continuity Studio is a creator tool for generating AI video sequences where the
same character stays visually and narratively consistent across shots. Creators
enter a scene brief, connect their own video provider key and Backblaze B2
bucket, then generate a shot from a locked continuity package that includes
character identity, wardrobe, hair, face traits, environment, camera direction,
motion, voice direction, and negative prompts.

The product solves a real creator pain: AI video models often change a
character's face, clothes, hair, mood, or setting between clips. Continuity
Studio narrows the creative possibility field before generation and stores the
approved output in durable object storage.

## Providers and models used

- OpenAI Sora 2: `sora-2` for 1280x720 video generation.
- GMI Cloud Kling: `Kling-Image2Video-V2.1-Master` through Genblaze for
  reference/image-to-video workflows.
- Backblaze B2: S3-compatible storage for generated MP4s, references,
  provenance records, thumbnails, logs, and future final-frame handoffs.

## How Backblaze B2 is used

The app asks creators for a restricted B2 application key and bucket. The media
worker verifies the bucket before generation, uploads generated MP4 files into
B2 under project and shot paths, and returns short-lived presigned playback
URLs so the browser can play the generated video without exposing B2
credentials.

The planned production object layout also stores character references, voice
references, locked JSON specifications, clean final frames for next-shot
handoff, continuity evaluation JSON, logs, and Genblaze manifests.

## How Genblaze is used

The Python media worker uses Genblaze as the orchestration layer for provider
workflows. For GMI Cloud, it builds a Genblaze `Pipeline`, calls the Kling
video provider, and writes assets to B2 through a Genblaze S3 storage sink.

The worker also includes Genblaze provider packages for OpenAI and S3 storage.
The current Sora path calls the OpenAI Videos API directly for reliability,
then stores the MP4 in Backblaze B2; this keeps the product functional while
preserving the same provider-isolated worker architecture.

## What makes it production-oriented

- Bring-your-own-key provider and B2 setup.
- Server-side worker with bearer-token protection.
- Session-scoped credentials excluded from run records and manifests.
- Durable B2 storage rather than temporary browser-only assets.
- Clear run lifecycle: queued, compiling, generating, complete, failed.
- Playable video validation before the UI reports success.
- Cost estimate before generation.
- Roadmap for managed queue, Postgres, retry/evaluation loops, and final-frame
  handoff between sequential shots.

## Demo video outline

1. Open Continuity Studio and show the locked character bible.
2. Show the continuity JSON generated from the scene brief.
3. Connect Backblaze B2 and a video provider with bring-your-own-key fields.
4. Start a shot generation and show queued/generating states.
5. Show the generated MP4 playing in the browser.
6. Explain that the MP4 is stored in B2 and returned through a presigned URL.
7. Show the provider/model list and the path toward reference-to-video and
   final-frame handoff.

## Genblaze GitHub starred?

Yes.
