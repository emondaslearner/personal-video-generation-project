# Image Generation (Phase 8)

## Overview

After a Production Package is **approved**, Framewright can generate scene images with Cloudflare Workers AI **FLUX.2 Klein 4B** (`@cf/black-forest-labs/flux-2-klein-4b`).

Design goals:
- Only generate after explicit user approval
- Strong prompts that incorporate visual style + character consistency notes
- Optional reference images from `characterProfiles` (when files exist under `references/`)
- Store real PNG paths and update `scene.image` + assets index
- Same orchestration pattern as narration generation

## Quality approach

1. **Prompt construction** – scene `visualPrompt` + global visual style + character appearance/clothing/distinguishing features + quality boosters
2. **Negative prompt** – scene + global negatives + common artifacts
3. **Dimensions** – project resolution, clamped to model-friendly multiples of 16 (max side 1280)
4. **References** – up to 4 character reference images when present on disk

## API

| Method | Path | Purpose |
|--------|------|--------|
| POST | `/projects/:id/production/generate-images` | Generate all pending scenes |
| POST | `/projects/:id/production/generate-images/:sceneId` | Regenerate one scene |
| GET | `/projects/:id/production/image-status` | Per-scene status |

### Generate body

```json
{
  "force": false
}
```

Requires an approved package. Returns per-scene results and the updated project.

## Storage

Files are written under `projects/<id>/frames/scene_XX_<shortid>.png`.

Each scene receives:

```ts
image: {
  path: string;
  prompt: string;          // the final prompt that was sent
  width: number;
  height: number;
  status: "generated";
}
```

## Prerequisites

- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` set in the monorepo root `.env`
- Project has passed approval
- Sufficient Workers AI neurons / quota

## Model note

Default model is the fast distilled **FLUX.2 Klein 4B**. It supports multipart form data and optional reference images (`input_image_0` … `input_image_3`). Steps are fixed by the model.

## FLUX prompt optimization

`buildImagePrompt` structures prompts for FLUX.2 Klein:

1. **Scene visual prompt first** (subject, action, setting)
2. **Short character lock** (only characters named in the scene when possible)
3. **Lighting / palette** from `visualStyle`
4. **Camera + aspect** (explicit 9:16 full-bleed when vertical)
5. **Compact style + quality tokens**

**Not injected into image prompts:** long `globalInstructions` narrative text (that is for production process, not pixels).

Negative prompts are deduped and focused on artifacts: blur, anatomy errors, text/watermarks, cartoon, letterboxing, split-screen/collage.

Prompt length is capped (~1800 chars) so attention is not diluted.

Re-run **Generate Images** with `force` / regen per scene after changing prompt logic.
