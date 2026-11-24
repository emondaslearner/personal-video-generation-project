# Video Export

## Overview

After a production package is approved and scenes have narration (and ideally images), you can render a final MP4.

## API

```
POST /projects/:id/production/export
```

Optional body:

```json
{ "name": "my_episode_v1" }
```

Response on success:

```json
{
  "status": "completed",
  "outputPath": "exports/export_2026-11-22_abc123.mp4",
  "downloadUrl": "/assets/<projectId>/exports/export_2026-11-22_abc123.mp4",
  "sizeBytes": 1234567,
  "durationInFrames": 900
}
```

## Behaviour

1. Requires approved production package and at least one scene.
2. Converts scene asset paths to absolute filesystem paths.
3. Writes a temporary props JSON and runs `remotion render` in `story-video-engine`.
4. Output lands in `projects/<id>/exports/`.
5. Download via the existing assets route.

## Studio

When status is **Approved**, an **Export Video** button appears next to Generate Narration / Generate Images. On success it opens the download URL.

## Notes

- First render may download Chromium / take several minutes.
- Ensure generated images and audio exist for the best result.
- Render uses `assetMode: "render"` so media is loaded from disk, not the API.

## Music volume

The export endpoint accepts an optional `musicVolume` (0–1) in the request body. Studio sends the current slider value automatically.

Priority when resolving volume:
1. Explicit `musicVolume` in the export request
2. `project.settings.musicVolume` (persisted from the last successful export)
3. Default `0.22`

After a successful export that includes a volume, the value is written back to `project.settings.musicVolume` so it is restored when the project is reopened.

## Out of memory (code 134 / heap limit)

Large 9:16 projects can exceed Node's default ~2GB heap during Remotion render.

Export automatically runs with `--max-old-space-size=8192` and `--concurrency=1`.

Override via env:

```env
REMOTION_MAX_OLD_SPACE_SIZE=12288
REMOTION_CONCURRENCY=1
```

If it still OOMs, close other apps, try a smaller test project, or lower resolution temporarily.
