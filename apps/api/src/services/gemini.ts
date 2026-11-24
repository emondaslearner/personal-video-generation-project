import { env } from "../lib/env.js";
import type {
  ProductionPackage,
  GeminiVerificationReport,
} from "@framewright/shared";

/**
 * Gemini Flash gatekeeper (configured as Gemini 3.1 Flash-Lite intent).
 *
 * Role: creative consistency checker only.
 * - Does NOT invent a new production package from scratch.
 * - Does NOT auto-apply changes.
 * - Returns a structured report of issues + optional proposed improvements.
 */

export type GeminiGatekeeperResult = {
  report: GeminiVerificationReport;
  proposedPackage?: ProductionPackage;
};

function buildGatekeeperPrompt(pkg: ProductionPackage): string {
  return `You are the creative gatekeeper for Framewright, a personal story-to-video production system.

Your job is STRICTLY limited to:
1. Checking the submitted Production Package for creative inconsistencies, weak or vague instructions, missing important details, and contradictions.
2. Suggesting concrete improvements only where necessary.
3. Never rewriting the story or narration unless there is a clear problem.
4. Never inventing new scenes or characters that the user did not provide.

Return a JSON object with this exact shape (no markdown, no extra text):
{
  "summary": "short overall assessment",
  "overallScore": number between 0 and 100,
  "issues": [
    {
      "severity": "critical" | "important" | "suggestion",
      "path": "optional json path, e.g. scenes[0].visualPrompt",
      "message": "clear description of the issue",
      "proposedFix": "optional concrete suggestion"
    }
  ],
  "proposedPackage": null or a full improved ProductionPackage object (only if meaningful improvements exist)
}

Rules for proposedPackage:
- Only include it if you have meaningful, non-trivial improvements.
- Keep the same schemaVersion, scene numbers, and character ids.
- Preserve the user's originalNarration text unless there is a clear error.
- Prefer improving visualPrompt, narrationInstructions, emotion, and global style notes.

Here is the Production Package to review:

${JSON.stringify(pkg, null, 2)}
`;
}

export async function runGeminiGatekeeper(
  pkg: ProductionPackage,
): Promise<GeminiGatekeeperResult> {
  if (!env.geminiApiKey) {
    return {
      report: {
        summary:
          "Gemini API key is not configured. Skipping creative gatekeeper. Node.js validation results still apply.",
        issues: [
          {
            severity: "important",
            message:
              "GEMINI_API_KEY is missing. Add it to your .env to enable the creative gatekeeper.",
          },
        ],
        overallScore: undefined,
      },
    };
  }

  const model = env.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.geminiApiKey}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: buildGatekeeperPrompt(pkg) }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      return {
        report: {
          summary: `Gemini API error (${res.status})`,
          issues: [
            {
              severity: "critical",
              message: `Gemini request failed: ${res.status} ${errorText.slice(0, 300)}`,
            },
          ],
        },
      };
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    if (!text) {
      return {
        report: {
          summary: "Gemini returned an empty response",
          issues: [
            {
              severity: "important",
              message: "No content received from Gemini.",
            },
          ],
        },
      };
    }

    let parsed: {
      summary?: string;
      overallScore?: number;
      issues?: GeminiVerificationReport["issues"];
      proposedPackage?: ProductionPackage | null;
    };

    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        report: {
          summary: "Gemini returned non-JSON content",
          issues: [
            {
              severity: "important",
              message: "Could not parse Gemini response as JSON.",
              proposedFix: text.slice(0, 500),
            },
          ],
        },
      };
    }

    const report: GeminiVerificationReport = {
      summary: parsed.summary ?? "No summary provided",
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      overallScore:
        typeof parsed.overallScore === "number"
          ? Math.max(0, Math.min(100, parsed.overallScore))
          : undefined,
    };

    const proposedPackage =
      parsed.proposedPackage && typeof parsed.proposedPackage === "object"
        ? (parsed.proposedPackage as ProductionPackage)
        : undefined;

    return { report, proposedPackage };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown Gemini error";
    return {
      report: {
        summary: "Gemini gatekeeper call failed",
        issues: [
          {
            severity: "critical",
            message,
          },
        ],
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
