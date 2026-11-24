import { env } from "../lib/env.js";

export type KokoroHealthResult =
  | { reachable: true; baseUrl: string; detail: string }
  | { reachable: false; baseUrl: string; error: string };

export type GenerateSpeechOptions = {
  text: string;
  voice?: string;
  speed?: number;
  format?: "wav" | "mp3";
};

export type GenerateSpeechResult = {
  buffer: Buffer;
  contentType: string;
  durationSeconds: number;
  voice: string;
  speed: number;
  format: "wav" | "mp3";
};

/**
 * Probe the configured Kokoro service from this process.
 */
export async function checkKokoroConnectivity(
  timeoutMs = 4000,
): Promise<KokoroHealthResult> {
  const baseUrl = env.kokoroBaseUrl.replace(/\/$/, "");
  const candidates = [
    `${baseUrl}/health`,
    `${baseUrl}/v1/models`,
    `${baseUrl}/docs`,
    baseUrl,
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: env.kokoroApiKey
            ? { Authorization: `Bearer ${env.kokoroApiKey}` }
            : undefined,
        });
        if (res.ok || res.status === 404 || res.status === 405) {
          return {
            reachable: true,
            baseUrl,
            detail: `Responded ${res.status} from ${url}`,
          };
        }
      } catch {
        // try next candidate
      }
    }
    return {
      reachable: false,
      baseUrl,
      error: `No successful response from ${baseUrl} (tried health, v1/models, docs, root)`,
    };
  } catch (err) {
    return {
      reachable: false,
      baseUrl,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Recommended Kokoro voices for English cinematic narration.
 * Servers that only support a subset will ignore unknown ids.
 */
export const KOKORO_VOICE_PRESETS = {
  narrative_warm: "af_bella",
  narrative_soft: "af_heart",
  narrative_clear: "af_sarah",
  narrative_deep: "am_adam",
  narrative_steady: "am_michael",
} as const;

/** Map loose emotion labels → slight speed multipliers (around 1.0). */
export function speedForEmotion(emotion?: string, baseSpeed = 1): number {
  const e = (emotion || "").toLowerCase();
  let factor = 1;
  if (/peace|calm|reflect|warm|hope|gentle|quiet/.test(e)) factor = 0.92;
  else if (/tense|alarm|urgent|worry|fear|storm/.test(e)) factor = 1.05;
  else if (/determin|courage|climb|struggl/.test(e)) factor = 0.97;
  else if (/triumph|uplift|spark|return/.test(e)) factor = 0.95;
  else if (/suspens/.test(e)) factor = 0.94;
  return clampSpeed(baseSpeed * factor);
}

/** Prefer a warmer/softer voice for intimate scenes when no explicit voice is set. */
export function voiceForEmotion(emotion?: string, fallback = "af_bella"): string {
  const e = (emotion || "").toLowerCase();
  if (/peace|calm|warm|hope|gentle|reflect|morning|home/.test(e)) {
    return KOKORO_VOICE_PRESETS.narrative_soft;
  }
  if (/tense|alarm|urgent|storm|dark/.test(e)) {
    return KOKORO_VOICE_PRESETS.narrative_clear;
  }
  return fallback || KOKORO_VOICE_PRESETS.narrative_warm;
}

/**
 * Cinematic text preparation for Kokoro.
 * - Strip stage directions Kokoro would read aloud
 * - Normalize punctuation for natural prosody
 * - Insert light breath pauses after sentences (without SSML)
 * - Keep delivery clear and story-like
 */
export function prepareSpokenText(raw: string): string {
  let text = raw ?? "";

  // Remove bracketed / parenthetical stage directions and emotion tags
  text = text.replace(
    /\[(?:happy|sad|angry|calm|whisper|excited|tense|soft|warm|laughs?|sighs?|gasps?|pause|emotion|tone|style|beat)[^\]]*\]/gi,
    " ",
  );
  text = text.replace(
    /\((?:pause|beat|whisper|laugh|sigh|gasp|softly|quietly|loudly|tense|calm)[^)]*\)/gi,
    " ",
  );

  // Normalize fancy punctuation Kokoro handles inconsistently
  text = text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, " - ")
    .replace(/…/g, "...");

  // Collapse whitespace; keep paragraph breaks as sentence boundaries
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Line breaks between clauses → period for clearer sentence ends
  text = text.replace(/([a-zA-Z0-9"'])\s*\n+/g, "$1. ");

  // Ensure terminal punctuation on the full string
  text = text.replace(/\s+/g, " ").trim();
  if (text && !/[.!?…]["']?$/.test(text)) {
    text += ".";
  }

  // Light prosody: space after sentence punctuation (Kokoro breathes better)
  text = text.replace(/([.!?])([A-Z"'])/g, "$1 $2");

  // Avoid double periods / messy spacing
  text = text
    .replace(/\.\s*\./g, ".")
    .replace(/ {2,}/g, " ")
    .trim();

  return text;
}

/**
 * Measure duration of a WAV buffer (PCM).
 * Uses byteRate from the fmt chunk when available; clamps to a sane range.
 */
export function measureWavDurationSeconds(buffer: Buffer): number {
  const fallback = estimateDurationFromLength(buffer.length, "wav");
  try {
    if (buffer.length < 44) return fallback;

    const riff = buffer.toString("ascii", 0, 4);
    const wave = buffer.toString("ascii", 8, 12);
    if (riff !== "RIFF" || wave !== "WAVE") {
      return fallback;
    }

    let offset = 12;
    let sampleRate = 0;
    let channels = 0;
    let bitsPerSample = 0;
    let byteRate = 0;
    let dataSize = 0;

    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString("ascii", offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const next = offset + 8 + chunkSize + (chunkSize % 2);

      if (chunkId === "fmt " && chunkSize >= 16) {
        // audioFormat at 0, channels at 2, sampleRate at 4, byteRate at 8, bits at 14
        channels = buffer.readUInt16LE(offset + 8 + 2);
        sampleRate = buffer.readUInt32LE(offset + 8 + 4);
        byteRate = buffer.readUInt32LE(offset + 8 + 8);
        bitsPerSample = buffer.readUInt16LE(offset + 8 + 14);
      } else if (chunkId === "data") {
        // Some writers put 0xFFFFFFFF for streaming; prefer remaining file size
        dataSize =
          chunkSize > 0 && chunkSize < 0xfffffff0
            ? chunkSize
            : Math.max(0, buffer.length - (offset + 8));
        break;
      }

      if (next <= offset) break; // corrupt
      offset = next;
    }

    let duration = 0;

    if (byteRate > 0 && dataSize > 0) {
      duration = dataSize / byteRate;
    } else if (sampleRate > 0 && channels > 0 && bitsPerSample > 0 && dataSize > 0) {
      const bytesPerSample = (bitsPerSample / 8) * channels;
      if (bytesPerSample > 0) {
        duration = dataSize / (sampleRate * bytesPerSample);
      }
    }

    // Reject absurd values (Kokoro scenes are typically 2–30s)
    if (!Number.isFinite(duration) || duration < 0.25 || duration > 180) {
      return fallback;
    }

    return Math.round(duration * 1000) / 1000;
  } catch {
    return fallback;
  }
}

function estimateDurationFromLength(byteLength: number, format: "wav" | "mp3"): number {
  // Rough fallback: 24kHz 16-bit mono for wav; ~128kbps for mp3
  if (format === "wav") {
    const seconds = byteLength / (24000 * 2);
    return clampSceneSeconds(seconds);
  }
  return clampSceneSeconds(byteLength / 16000);
}

/** Keep per-scene duration in a realistic range for narration. */
export function clampSceneSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 3;
  return Math.max(0.5, Math.min(90, Math.round(seconds * 1000) / 1000));
}

/** Estimate spoken duration from text when WAV timing is untrusted. */
export function estimateSecondsFromText(text: string, speed = 1): number {
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  // ~150 wpm English narration baseline
  const base = (words / 150) * 60;
  const adjusted = base / Math.max(0.5, speed || 1);
  // pad slightly for trailing silence
  return clampSceneSeconds(adjusted + 0.35);
}

/**
 * Generate speech via the local OpenAI-compatible Kokoro endpoint.
 */
export async function generateSpeech(
  options: GenerateSpeechOptions,
): Promise<GenerateSpeechResult> {
  const format = options.format === "mp3" ? "mp3" : "wav";
  const text = prepareSpokenText(options.text);

  if (!text || text.length < 2) {
    throw Object.assign(new Error("Spoken text is empty after preparation"), {
      statusCode: 400,
    });
  }

  // Default slightly under 1.0 — clearer cinematic pacing on Kokoro-82M
  const speed = clampSpeed(
    typeof options.speed === "number" ? options.speed : 0.95,
  );
  const voice = options.voice?.trim() || KOKORO_VOICE_PRESETS.narrative_warm;

  const baseUrl = env.kokoroBaseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/v1/audio/speech`;

  // OpenAI-compatible body; extra fields are ignored by strict servers
  const body: Record<string, unknown> = {
    model: process.env.KOKORO_MODEL || "kokoro",
    input: text,
    voice,
    speed,
    response_format: format,
  };

  // Prefer WAV for accurate duration measurement in Framewright
  if (format === "wav") {
    body.response_format = "wav";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.kokoroApiKey
          ? { Authorization: `Bearer ${env.kokoroApiKey}` }
          : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw Object.assign(
        new Error(
          `Kokoro speech failed (${res.status}): ${errorText.slice(0, 400)}`,
        ),
        { statusCode: 502 },
      );
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length < 100) {
      throw Object.assign(new Error("Kokoro returned an empty or tiny audio buffer"), {
        statusCode: 502,
      });
    }

    const contentType =
      res.headers.get("content-type") ||
      (format === "wav" ? "audio/wav" : "audio/mpeg");

    const measured =
      format === "wav"
        ? measureWavDurationSeconds(buffer)
        : estimateDurationFromLength(buffer.length, "mp3");

    // Cross-check with text length so a bad WAV header cannot create hour-long scenes
    const fromText = estimateSecondsFromText(text, speed);
    let durationSeconds = clampSceneSeconds(measured);
    // If measured is wildly longer than spoken text estimate, trust text+buffer hybrid
    if (measured > fromText * 3) {
      durationSeconds = clampSceneSeconds(Math.max(fromText, Math.min(measured, fromText * 1.8)));
    }

    return {
      buffer,
      contentType,
      durationSeconds,
      voice,
      speed,
      format,
    };
  } catch (err) {
    if (err && typeof err === "object" && "statusCode" in err) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw Object.assign(new Error(`Kokoro request failed: ${message}`), {
      statusCode: 502,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 0.95;
  // Kokoro is most natural roughly 0.7–1.2 for storytelling
  return Math.min(1.35, Math.max(0.7, speed));
}
