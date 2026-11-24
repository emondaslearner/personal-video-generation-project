# Asset resolution strategy (Phase 0)

Project JSON **always** stores **relative** paths from the project directory:

```
projects/story_001/
  project.json
  frames/scene_01.png    ← "frames/scene_01.png" in JSON
  audio/scene_01.wav     ← "audio/scene_01.wav" in JSON
```

## Preview (browser / @remotion/player)

- Studio sets `assetMode: "preview"` and `assetBaseUrl: "/api/assets/{projectId}"`.
- Vite proxies browser requests under `/api` to the Framewright API at `127.0.0.1:8788`.
- The composition builds image/audio URLs as `${assetBaseUrl}/${relativePath}`.
- The API serves files from `projects/{projectId}/` at `GET /assets/:projectId/*` with path-traversal protection.

## Final render (Remotion Node renderer)

- Render job sets `assetMode: "render"`.
- Relative paths are resolved against the absolute project directory on disk (or copied into the Remotion public/static folder as needed).
- No browser URL is required.

This keeps a **single composition** and a **single project schema** for both preview and export.
