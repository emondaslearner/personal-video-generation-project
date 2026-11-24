import { env } from "../lib/env.js";

export type FluxHealthResult =
  | { reachable: true; accountConfigured: boolean; detail: string }
  | { reachable: false; accountConfigured: boolean; error: string };

export type GenerateImageOptions = {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  /** Optional reference image buffers (max 4, each ideally ≤512×512) */
  referenceImages?: Buffer[];
};

export type GenerateImageResult = {
  buffer: Buffer;
  contentType: string;
  width: number;
  height: number;
  model: string;
};

const DEFAULT_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

/**
 * Check whether Cloudflare credentials are present (we cannot fully probe
 * the model without spending neurons).
 */
export async function checkFluxConnectivity(): Promise<FluxHealthResult> {
  const accountConfigured = Boolean(
    env.cloudflareAccountId && env.cloudflareApiToken,
  );

  if (!accountConfigured) {
    return {
      reachable: false,
      accountConfigured: false,
      error: "CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is missing",
    };
  }

  // Lightweight probe: hit the models list endpoint if available, otherwise
  // just report credentials are present.
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${env.cloudflareAccountId}/ai/models/search`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.cloudflareApiToken}`,
      },
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok || res.status === 400 || res.status === 403) {
      return {
        reachable: true,
        accountConfigured: true,
        detail: `Credentials present (HTTP ${res.status})`,
      };
    }

    return {
      reachable: false,
      accountConfigured: true,
      error: `Cloudflare API responded ${res.status}`,
    };
  } catch (err) {
    // Network errors still mean credentials exist; the real call will surface issues.
    return {
      reachable: true,
      accountConfigured: true,
      detail: `Credentials present (probe failed: ${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

/**
 * Build a FLUX-optimized image prompt.
 *
 * FLUX responds best to clear natural-language scene descriptions:
 * subject + action + setting first, then lighting, camera, style.
 * Avoid dumping long narrative / production instructions into the image prompt.
 */
export function buildImagePrompt(options: {
  sceneVisualPrompt: string;
  sceneNegativePrompt?: string;
  visualStyle?: {
    overallStyle?: string;
    colorPalette?: string;
    lighting?: string;
    cameraLanguage?: string;
    negativePrompt?: string;
    referenceNotes?: string;
    additionalNotes?: string;
  };
  characterNotes?: string[];
  /** Kept for API compatibility; narrative text is NOT injected into the image prompt. */
  globalInstructions?: string;
  aspectRatio?: "9:16" | "16:9" | string;
}): { prompt: string; negativePrompt: string } {
  const scene = (options.sceneVisualPrompt || "").trim();
  const style = options.visualStyle;

  // --- Positive prompt: ordered for FLUX ---
  // 1) Core scene (highest weight in practice)
  // 2) Character lock (short)
  // 3) Lighting / palette
  // 4) Camera / framing
  // 5) Style tags (short, not paragraph)
  // 6) Quality tokens
  const sections: string[] = [];

  if (scene) {
    sections.push(scene);
  }

  // Character consistency — only short, visual traits (already pre-formatted)
  const chars = (options.characterNotes ?? [])
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (chars.length > 0) {
    sections.push(
      `Character consistency: ${chars.join(" | ")}. Same person across frames, identical face and outfit`,
    );
  }

  const lightBits: string[] = [];
  if (style?.lighting?.trim()) lightBits.push(style.lighting.trim());
  if (style?.colorPalette?.trim()) lightBits.push(`palette: ${style.colorPalette.trim()}`);
  if (lightBits.length) {
    sections.push(lightBits.join(", "));
  }

  const cameraBits: string[] = [];
  if (style?.cameraLanguage?.trim()) {
    // Keep camera notes short — take first sentence only
    const cam = style.cameraLanguage.trim().split(".")[0]?.trim();
    if (cam) cameraBits.push(cam);
  }
  const ar = options.aspectRatio || "9:16";
  if (ar === "9:16" || ar.startsWith("9")) {
    cameraBits.push("vertical 9:16 portrait composition, full-bleed frame, no letterboxing");
  } else if (ar === "16:9" || ar.startsWith("16")) {
    cameraBits.push("horizontal 16:9 widescreen composition, full-bleed frame");
  }
  if (cameraBits.length) {
    sections.push(cameraBits.join(", "));
  }

  // Style: prefer compact overallStyle, skip long reference/additional essays
  if (style?.overallStyle?.trim()) {
    const overall = style.overallStyle.trim();
    // Cap very long style blocks
    sections.push(overall.length > 220 ? overall.slice(0, 220).trim() : overall);
  }

  if (style?.referenceNotes?.trim()) {
    const ref = style.referenceNotes.trim().split(".")[0]?.trim();
    if (ref) sections.push(ref);
  }

  sections.push(
    "photorealistic, cinematic still, sharp focus, natural skin texture, coherent anatomy, high detail",
  );

  // Join with periods for natural language flow; collapse whitespace
  let prompt = sections
    .join(". ")
    .replace(/\s+/g, " ")
    .replace(/\s*\.\s*/g, ". ")
    .replace(/\.+ /g, ". ")
    .trim();
  if (!prompt.endsWith(".")) prompt += ".";

  // Hard length guard — extremely long prompts dilute FLUX attention
  const MAX_PROMPT = 1800;
  if (prompt.length > MAX_PROMPT) {
    prompt = prompt.slice(0, MAX_PROMPT - 1).trim() + ".";
  }

  // --- Negative prompt: compact, visual artifacts only ---
  const neg = new Set<string>();
  const addNeg = (raw?: string) => {
    if (!raw) return;
    for (const part of raw.split(/[,;]/)) {
      const t = part.trim().toLowerCase();
      if (t && t.length < 80) neg.add(t);
    }
  };
  addNeg(options.sceneNegativePrompt);
  addNeg(style?.negativePrompt);
  // Always-on quality guards for Klein
  for (const n of [
    "blurry",
    "low quality",
    "low resolution",
    "deformed",
    "distorted face",
    "bad anatomy",
    "extra fingers",
    "extra limbs",
    "duplicate person",
    "text",
    "subtitle",
    "watermark",
    "logo",
    "cartoon",
    "anime",
    "illustration",
    "letterboxing",
    "black bars",
    "split screen",
    "collage",
    "multiple panels",
  ]) {
    neg.add(n);
  }

  return {
    prompt,
    negativePrompt: [...neg].join(", "),
  };
}

/**
 * Clamp dimensions to values the model is likely to accept (multiples of 16,
 * reasonable max for Klein).
 */
export function clampDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  const maxSide = 1280;
  let w = Math.max(256, Math.round(width / 16) * 16);
  let h = Math.max(256, Math.round(height / 16) * 16);

  if (w > maxSide || h > maxSide) {
    const scale = maxSide / Math.max(w, h);
    w = Math.round((w * scale) / 16) * 16;
    h = Math.round((h * scale) / 16) * 16;
  }

  return { width: w, height: h };
}

/**
 * Generate an image via Cloudflare Workers AI FLUX.2 Klein 4B.
 * Uses multipart/form-data as required by the model.
 */
export async function generateImage(
  options: GenerateImageOptions,
): Promise<GenerateImageResult> {
  if (!env.cloudflareAccountId || !env.cloudflareApiToken) {
    throw Object.assign(
      new Error(
        "Cloudflare Workers AI is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.",
      ),
      { statusCode: 503 },
    );
  }

  const prompt = (options.prompt || "").trim();
  if (prompt.length < 3) {
    throw Object.assign(new Error("Image prompt is empty or too short"), {
      statusCode: 400,
    });
  }

  const { width, height } = clampDimensions(options.width, options.height);
  const model = DEFAULT_MODEL;
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.cloudflareAccountId}/ai/run/${model}`;

  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(width));
  form.append("height", String(height));

  // Optional negative prompt (supported by many FLUX variants; ignored if not)
  if (options.negativePrompt?.trim()) {
    form.append("negative_prompt", options.negativePrompt.trim());
  }

  // Reference images (max 4, model prefers ≤512×512)
  const refs = (options.referenceImages ?? []).slice(0, 4);
  for (let i = 0; i < refs.length; i++) {
    const u8 = new Uint8Array(refs[i]);
    const blob = new Blob([u8], { type: "image/png" });
    form.append(`input_image_${i}`, blob, `ref_${i}.png`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.cloudflareApiToken}`,
        // Content-Type is set automatically by FormData
      },
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw Object.assign(
        new Error(
          `FLUX generation failed (${res.status}): ${errorText.slice(0, 500)}`,
        ),
        { statusCode: 502 },
      );
    }

    const contentType = res.headers.get("content-type") || "";
    let buffer: Buffer;

    if (contentType.includes("application/json")) {
      const json = (await res.json()) as {
        result?: { image?: string };
        image?: string;
        success?: boolean;
        errors?: unknown[];
      };

      const b64 =
        json.result?.image ??
        json.image ??
        (typeof (json as any).result === "string" ? (json as any).result : null);

      if (!b64 || typeof b64 !== "string") {
        throw Object.assign(
          new Error(
            `FLUX returned JSON without a base64 image field: ${JSON.stringify(json).slice(0, 300)}`,
          ),
          { statusCode: 502 },
        );
      }

      // Strip data-url prefix if present
      const pure = b64.replace(/^data:image\/\w+;base64,/, "");
      buffer = Buffer.from(pure, "base64");
    } else {
      // Raw image bytes
      const ab = await res.arrayBuffer();
      buffer = Buffer.from(ab);
    }

    if (buffer.length < 500) {
      throw Object.assign(
        new Error("FLUX returned an empty or tiny image buffer"),
        { statusCode: 502 },
      );
    }

    return {
      buffer,
      contentType: "image/png",
      width,
      height,
      model,
    };
  } catch (err) {
    if (err && typeof err === "object" && "statusCode" in err) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw Object.assign(new Error(`FLUX request failed: ${message}`), {
      statusCode: 502,
    });
  } finally {
    clearTimeout(timeout);
  }
}
