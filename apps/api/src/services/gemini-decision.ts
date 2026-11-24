import { randomUUID } from "node:crypto";
import { env } from "../lib/env.js";
import type {
  DecisionRequest,
  DecisionResult,
  DecisionType,
} from "@framewright/shared";

/**
 * Phase 5 – Gemini Decision 1
 *
 * Strictly bounded decisions only. Node.js owns routing and control.
 * Gemini answers the question and nothing else. Results are never
 * auto-applied to the production package.
 */

function buildDecisionPrompt(req: DecisionRequest): string {
  const scoreMin = req.scoreMin ?? 0;
  const scoreMax = req.scoreMax ?? 100;

  let typeInstructions = "";
  switch (req.type) {
    case "yes_no":
      typeInstructions = `Answer with exactly "yes" or "no" (lowercase).`;
      break;
    case "multiple_choice":
      typeInstructions = `You MUST choose exactly one of these options:\n${(req.options ?? [])
        .map((o, i) => `  ${i + 1}. ${o}`)
        .join("\n")}\nReturn the exact option text as the answer.`;
      break;
    case "score":
      typeInstructions = `Return a numeric score between ${scoreMin} and ${scoreMax} (inclusive).`;
      break;
  }

  return `You are the Decision-1 module for Framewright.

Your role is STRICTLY limited:
- Answer ONLY the specific question below.
- Do NOT rewrite stories, invent scenes, or propose package changes.
- Do NOT add extra advice outside the required JSON.

${typeInstructions}

Return a JSON object with this exact shape (no markdown, no extra text):
{
  "answer": "string – the chosen answer",
  "score": number or null,          // only for type "score"
  "rationale": "one or two short sentences explaining the choice",
  "confidence": number between 0 and 1
}

Question:
${req.question}

${req.context ? `Context:\n${req.context}\n` : ""}
${req.relatedPath ? `Related path: ${req.relatedPath}\n` : ""}`;
}

export async function runGeminiDecision(
  req: DecisionRequest,
): Promise<DecisionResult> {
  const id = req.id ?? randomUUID();
  const decidedAt = new Date().toISOString();

  // Validate request shape for the type first (applies even without API key)
  if (req.type === "multiple_choice" && (!req.options || req.options.length < 2)) {
    throw Object.assign(
      new Error("multiple_choice decisions require at least two options"),
      { statusCode: 400 },
    );
  }

  if (!env.geminiApiKey) {
    return {
      id,
      type: req.type,
      question: req.question,
      answer: req.type === "yes_no" ? "no" : req.type === "score" ? String(req.scoreMin ?? 0) : (req.options?.[0] ?? "unknown"),
      score: req.type === "score" ? (req.scoreMin ?? 0) : undefined,
      rationale:
        "Gemini API key is not configured. Returning a safe default answer. Add GEMINI_API_KEY to enable real decisions.",
      confidence: 0,
      decidedAt,
      relatedPath: req.relatedPath,
    };
  }

  const model = env.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.geminiApiKey}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: buildDecisionPrompt(req) }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw Object.assign(
        new Error(`Gemini Decision API error (${res.status}): ${errorText.slice(0, 200)}`),
        { statusCode: 502 },
      );
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    if (!text) {
      throw Object.assign(new Error("Gemini returned empty decision response"), {
        statusCode: 502,
      });
    }

    let parsed: {
      answer?: string;
      score?: number | null;
      rationale?: string;
      confidence?: number;
    };

    try {
      parsed = JSON.parse(text);
    } catch {
      throw Object.assign(
        new Error("Gemini returned non-JSON decision response"),
        { statusCode: 502 },
      );
    }

    let answer = String(parsed.answer ?? "").trim();
    let score: number | undefined;

    // Normalize / enforce type constraints
    if (req.type === "yes_no") {
      const lower = answer.toLowerCase();
      if (lower.startsWith("y")) answer = "yes";
      else if (lower.startsWith("n")) answer = "no";
      else answer = "no"; // safe default
    } else if (req.type === "multiple_choice") {
      const options = req.options ?? [];
      const match = options.find(
        (o) => o.toLowerCase() === answer.toLowerCase(),
      );
      if (match) {
        answer = match;
      } else {
        // fallback to first option if Gemini drifted
        answer = options[0] ?? answer;
      }
    } else if (req.type === "score") {
      const min = req.scoreMin ?? 0;
      const max = req.scoreMax ?? 100;
      const raw =
        typeof parsed.score === "number"
          ? parsed.score
          : Number.parseFloat(answer);
      score = Number.isFinite(raw)
        ? Math.max(min, Math.min(max, raw))
        : min;
      answer = String(score);
    }

    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : undefined;

    return {
      id,
      type: req.type,
      question: req.question,
      answer,
      score,
      rationale: parsed.rationale?.trim() || undefined,
      confidence,
      decidedAt,
      relatedPath: req.relatedPath,
    };
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err;
    const message = err instanceof Error ? err.message : "Unknown decision error";
    throw Object.assign(new Error(message), { statusCode: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
