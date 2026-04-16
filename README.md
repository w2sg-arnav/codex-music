# Codex Music

Codex Music is an AI-native music editing studio designed as a full-stack web application. The product direction is editor-first: import audio, turn it into editable musical structure, apply AI-assisted edits, collaborate on versions, and export with rights-aware provenance.

## Product Direction

- Web-first multitrack studio built with `Next.js`.
- Python orchestration layer built with `FastAPI`.
- Reuse-first audio stack: separation, transcription, MIDI extraction, analysis, cleanup, and provenance come from proven components before we build custom replacements.
- Our moat lives in the studio UX, project graph, edit history, collaboration, and rights-aware export flow.

## Quick Start

1. Install the web dependencies:

   ```bash
   npm install
   ```

2. Install the API dependencies:

   ```bash
   npm run setup:api
   ```

3. Copy the root environment template:

   ```bash
   cp .env.example apps/web/.env.local
   cp .env.example apps/api/.env
   ```

4. Start the full stack locally:

   ```bash
   npm run dev
   ```

The web app runs on `http://127.0.0.1:3000` and the API runs on `http://127.0.0.1:8000`.

## Recommended Live Deployment

- `apps/web`: Vercel or another Next.js-optimized frontend host.
- `apps/api`: Fly.io, Render, Railway, or Modal depending on how much GPU-backed inference we self-host.
- `Storage`: S3 or Cloudflare R2 for raw audio, stems, and export artifacts.
- `Database`: managed Postgres for projects, edits, comments, and rights metadata.
- `Queue / workflows`: Temporal once long-running renders and provider fan-out are in place.

## Reuse-First Provider Strategy

- Stem separation: AudioShake or Music.AI first, Demucs-compatible self-host path later.
- Audio-to-MIDI: Spotify Basic Pitch.
- Music analysis: Essentia.
- Lyrics and timestamps: WhisperX or partner APIs.
- Cleanup and loudness: Auphonic or self-hosted DSP later.
- Provenance: C2PA.
