# Project asset upload API

Framewright stores uploaded assets inside the existing project directory. Project JSON continues to store relative paths only.

## Endpoint

`POST /projects/:projectId/assets/:category`

Send a multipart/form-data request with exactly one file field named `file`.

Supported categories and formats:

| Category | Project directory | Allowed formats |
| --- | --- | --- |
| `frames` | `frames/` | PNG, JPEG, WebP |
| `references` | `references/` | PNG, JPEG, WebP |
| `audio` | `audio/` | WAV, MP3, M4A, OGG |
| `music` | `music/` | WAV, MP3, M4A, OGG |
| `sound-effects` | `sound-effects/` | WAV, MP3, M4A, OGG |

Maximum file size is 50 MB. The API generates a UUID filename and does not use the uploaded filename as a filesystem path.

## Example

```bash
curl -X POST \
  -F "file=@./scene.png" \
  http://127.0.0.1:8788/projects/PROJECT_ID/assets/frames
```

A successful upload returns HTTP 201 and an asset object containing its category, relative path, generated filename, byte size, and MIME type.

## Index behavior

- `frames` paths are appended to `project.assets.images`.
- `audio` paths are appended to `project.assets.audio`.
- `music` paths are appended to `project.assets.music`.
- `sound-effects` paths are appended to `project.assets.soundEffects`.
- `references` paths are returned to the caller and are intended to be attached to character profiles through the normal project update API.

Project JSON writes remain atomic. Asset-index writes are serialized per project within the API process to avoid concurrent uploads overwriting one another's index updates.

## Notes

This endpoint is intended for the local single-user Framewright API. It does not implement user authentication or multi-user authorization. MIME type and extension are checked, but content-signature validation and malware scanning are not yet implemented.
