# Gemini Decision 1 (Phase 5)

Bounded decision support for Framewright.

## Role

- **Node.js owns routing and control.**
- Gemini answers a single, strictly bounded question.
- Results are **never** auto-applied to the production package.
- Generation remains blocked until the user explicitly approves the package.

## Supported decision types

| Type              | Description                          | Required fields          |
|-------------------|--------------------------------------|--------------------------|
| `yes_no`          | Binary choice                        | `question`               |
| `multiple_choice` | Choose exactly one option            | `question`, `options[]`  |
| `score`           | Numeric score in a range (default 0–100) | `question`, optional `scoreMin` / `scoreMax` |

## API

```
POST /projects/:id/production/decision
```

Request body (example):

```json
{
  "type": "yes_no",
  "question": "Should we keep the original visual style for scene 3?",
  "context": "Gatekeeper noted the lighting description is vague.",
  "relatedPath": "scenes[2].visualPrompt"
}
```

Response:

```json
{
  "status": "decided",
  "decision": {
    "id": "uuid",
    "type": "yes_no",
    "question": "...",
    "answer": "yes",
    "rationale": "...",
    "confidence": 0.82,
    "decidedAt": "ISO timestamp"
  }
}
```

## Studio

When a package is verified (or a Gemini report exists), a **Gemini Decision 1** panel appears under the gatekeeper report. You can:

1. Choose type (Yes/No, Multiple choice, Score).
2. Type a clear question.
3. Click **Ask Decision**.

The answer + rationale are shown immediately. Nothing is written into the approved package automatically.

## Design rules (from architecture)

- Decision 1 is a helper for ambiguous cases flagged by the gatekeeper or raised by the user.
- It does not replace the approval step.
- It does not invent new scenes, characters, or narration.
