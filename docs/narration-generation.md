# Narration Generation (Phase 7)

## Overview

After a Production Package is **approved**, Framewright can generate scene narration with the local Kokoro TTS service.

Design goals:
- Smooth, natural, emotionally appropriate delivery
- Real measured audio durations (no estimates)
- Never overwrite the locked original story text
- Generation only after explicit user approval

## Quality approach

Kokoro does not accept emotion tags. Quality comes from:

1. **Text preparation (medium)** – clean stage directions, normalize punctuation, preserve natural rhythm
2. **Voice selection** – default `af_bella` (strong English narration voice)
3. **Speed control** – per-scene or profile default (typically 0.9–1.1)
4. **Measured duration** – WAV header is parsed so Remotion uses real lengths

## API

| Method | Path | Purpose |
|--------|------|--------|
| POST | `/projects/:id/production/generate-narration` | Generate all pending scenes |
| POST | `/projects/:id/production/generate-narration/:sceneId` | Regenerate one scene |
| GET | `/projects/:id/production/narration-status` | Per-scene status |

### Generate body

```json
{
  "force": false,
  "voiceOverride": null,
  "speedOverride": null,
  "format": "wav"
}
```

Requires an approved package. Returns per-scene results and the updated project.

## Storage

Files are written under `projects/<id>/audio/scene_XX_<shortid>.wav`.

Each scene receives:

```ts
audio: {
  path: string;
  voice: string;
  speed: number;
  durationSeconds: number;   // measured
  status: "generated";
  generatedAt: string;
}
```

`durationInFrames` is recalculated from the measured duration and project fps.

## Prerequisites

- Kokoro running and reachable (`KOKORO_BASE_URL`, default `http://localhost:8880`)
- Project has passed approval
- Check reachability: `GET /health/kokoro`

## Optimized Kokoro settings

### Defaults
- Voice: `af_bella` (warm narrative); soft scenes may use `af_heart`
- Speed base: **0.95** (slightly slower than 1.0 for cinematic clarity)
- Speed is nudged by scene `emotion` (e.g. calm ~0.92×, urgent ~1.05×), clamped to **0.7–1.35**
- Format: WAV (accurate duration measurement)

### Text preparation
- Strips stage directions / emotion tags Kokoro would read aloud
- Normalizes quotes and dashes
- Ensures sentence-ending punctuation for better prosody

### Voice presets
| Preset | Voice id |
|--------|----------|
| narrative_warm | af_bella |
| narrative_soft | af_heart |
| narrative_clear | af_sarah |
| narrative_deep | am_adam |
| narrative_steady | am_michael |

Override per scene with `voice` / `speed` in the production package, or package `narrationProfile.defaultVoice` / `defaultSpeed`.

After changing settings, regenerate with **force** or per-scene **Regen narration**.
