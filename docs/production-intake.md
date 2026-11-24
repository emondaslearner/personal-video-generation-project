# Production Intake & Verification (Phase 1–2)

## Overview

Framewright does **not** invent the production package.  
You research and prepare the full production information externally, then submit it.

### Workflow

1. **Prepare** the Production Package (JSON) outside Framewright.
2. **Paste** it into the Studio Production Intake editor.
3. **Validate Structure** (pure Node.js / Zod).
4. **Submit Package** → stored as immutable `originalSubmission`.
5. **Run Verification** → Node.js checks + Gemini Flash creative gatekeeper.
6. **Review** errors, warnings, Gemini issues and any proposed package.
7. **Approve Package** (original or Gemini proposal) → only then can narration / image generation begin.

## Production Package Shape

See `ProductionPackageSchema` in `packages/shared/src/project-schema.ts`.

Key required fields per scene:
- `number`
- `originalNarration`
- `productionNarration`
- `visualPrompt`

## API Endpoints

| Method | Path | Purpose |
|--------|------|--------|
| POST | `/projects/:id/production/intake` | Submit original package |
| POST | `/projects/:id/production/validate` | Node.js validation only |
| POST | `/projects/:id/production/verify` | Full verification (Node.js + Gemini) |
| POST | `/projects/:id/production/approve` | Approve for generation |
| POST | `/projects/:id/production/reset` | Clear verification/approval |

## Three Data Layers

- `originalSubmission` — immutable user input
- `verification` — Node.js + Gemini results + optional proposed package
- `approvedPackage` — the package that will drive Kokoro / FLUX / Remotion

## Gemini Gatekeeper

- Model: configurable via `GEMINI_MODEL` (default `gemini-2.0-flash`)
- Role: creative consistency only (never auto-applies changes)
- Returns structured issues + optional `proposedPackage`
- Requires `GEMINI_API_KEY` in `.env`

## Status Flow

`Draft` → `Submitted` → `Validated` / `Verified` → `Approved`

## Narration Generation

After approval, use:

- `POST /projects/:id/production/generate-narration`
- `POST /projects/:id/production/generate-narration/:sceneId`
- `GET /projects/:id/production/narration-status`

See `docs/narration-generation.md` for the full design (voice quality, duration measurement, Remotion sync).
