# StoryVideo Composition

## Overview

The Remotion composition (`story-video-engine/src/StoryVideo.tsx`) is the single source of truth for both:

- **Studio live preview** (via `@remotion/player`)
- **Final render** (via `remotion render`)

## What it does now

| Feature | Behaviour |
|---------|-----------|
| Scene sequencing | Sequential `Sequence` blocks driven by each scene’s `durationInFrames` |
| Images | When `scene.image.path` exists and status is generated/accepted → full-bleed `Img` with `object-fit: cover` |
| Audio | When `scene.audio.status === "generated"` → `Audio` component plays the WAV/MP3 |
| Camera moves | Ken-Burns style transforms from `scene.camera.type` (`static`, `zoom_in`, `zoom_out`, `pan_*`) |
| Fade | Soft fade-in / fade-out on the first/last ~8 frames of each scene |
| Placeholder | Text card with narration when no image is present yet |
| Asset resolution | `assetMode: "preview"` + `assetBaseUrl` → `/api/assets/<projectId>/...` URLs for the Player |
| Transitions | `scene.transition`: `cut` (hard), `fade` (fade-to-black gap), `crossfade` (overlapping opacity) |

## Asset path rules

- Project JSON always stores **relative** paths (`frames/scene_01_xxx.png`, `audio/scene_01_xxx.wav`).
- Preview mode prefixes them with `assetBaseUrl` (Studio sets this to `/api/assets/<id>`).
- Render mode can use the same relative paths (or absolute filesystem paths when the render pipeline is fully wired).

## Duration source of truth

After narration generation, `durationInFrames` is recalculated from the **measured** audio duration × fps. The composition uses that value, so preview and final render stay in sync.

## Next improvements (not yet implemented)

- ~~Crossfade / fade transitions between scenes~~ (done)
- Subtitle burn-in
- Background music bed + volume ducking under narration
- Sound-effect layers
- Explicit export endpoint that runs `remotion render` and returns the MP4
