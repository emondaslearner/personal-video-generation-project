# Music bed & sound effects

## Music bed

If the project has at least one file in `assets.music` (uploaded under the `music` category), the composition plays it as a continuous background bed for the full video length.

- Default volume: **0.22** (intentionally ducked under narration)
- Loops if shorter than the composition
- Passed via `StoryVideoProps.musicPath` / `musicVolume`
- Preview uses `/api/assets/<id>/…`; export uses absolute filesystem paths

Upload a track with the existing asset upload API:

```
POST /projects/:id/assets/music
```

## Scene sound effects

Each scene may list relative paths in `scene.soundEffects[]`. Those clips play at the start of the scene at ~0.55× the scene audio envelope.

Paths should point at files already stored under the project (e.g. `sound-effects/whoosh.wav`).

## Notes

- No automatic music generation yet — supply your own bed.
- Volume is fixed for v1; a future mixer UI can expose per-project levels.
