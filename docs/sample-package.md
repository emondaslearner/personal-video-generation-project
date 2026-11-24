# Sample production package

Framewright ships with a ready-to-run sample: **The Lantern in the Pines** (3 scenes).

## How to try the full pipeline

1. Create or open a project in Studio.
2. In the Production Intake panel, click **Load sample package**.
3. Review the JSON (characters, visual style, 3 scenes with camera + transitions).
4. **Validate Structure** → **Submit Package** → **Run Verification**.
5. **Approve Original** (or Gemini proposal if one appears).
6. Use the readiness checklist or buttons:
   - **Generate missing** narration
   - **Generate missing** images
7. Preview in the Player (images, audio, camera, transitions, subtitles).
8. Optionally upload a music bed in Assets, adjust volume, then **Export MP4**.

## Requirements for generation

- **Narration:** Kokoro reachable (`GET /health/kokoro`), `KOKORO_BASE_URL` if not default.
- **Images:** `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (`GET /health/flux`).
- **Gemini gatekeeper / Decision 1:** `GEMINI_API_KEY` (optional; Node validation still works without it).

## Sample contents

- 1 character profile with consistency notes
- Cinematic visual style + negative prompt
- Narration profile defaulting to `af_bella`
- 3 scenes with original/production narration, visual prompts, camera moves, and fade/crossfade transitions

The sample is only loaded into the editor until you Submit — it does not overwrite an already approved package without confirmation.
