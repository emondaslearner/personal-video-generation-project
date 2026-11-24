import assert from "node:assert/strict";
import test from "node:test";

// Ensure no real Gemini calls during tests
process.env.GEMINI_API_KEY = "";

const { runGeminiDecision } = await import("./gemini-decision.js");

test("Decision 1 – yes_no returns a structured result without API key", async () => {
  const result = await runGeminiDecision({
    type: "yes_no",
    question: "Should we keep the original visual style?",
    context: "Gatekeeper noted vague lighting.",
  });

  assert.ok(result.id);
  assert.equal(result.type, "yes_no");
  assert.equal(result.question, "Should we keep the original visual style?");
  assert.ok(["yes", "no"].includes(result.answer));
  assert.ok(result.rationale);
  assert.ok(result.decidedAt);
  assert.equal(result.confidence, 0);
});

test("Decision 1 – multiple_choice requires options", async () => {
  await assert.rejects(
    () =>
      runGeminiDecision({
        type: "multiple_choice",
        question: "Which style?",
        // options missing
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as { statusCode?: number }).statusCode, 400);
      return true;
    },
  );
});

test("Decision 1 – multiple_choice with options returns one of the options", async () => {
  const options = ["Cinematic", "Documentary", "Animated"];
  const result = await runGeminiDecision({
    type: "multiple_choice",
    question: "Preferred overall style?",
    options,
  });

  assert.equal(result.type, "multiple_choice");
  assert.ok(options.includes(result.answer));
});

test("Decision 1 – score returns a number in range", async () => {
  const result = await runGeminiDecision({
    type: "score",
    question: "Rate the clarity of the visual prompts",
    scoreMin: 0,
    scoreMax: 100,
  });

  assert.equal(result.type, "score");
  assert.ok(typeof result.score === "number");
  assert.ok(result.score! >= 0 && result.score! <= 100);
  assert.equal(result.answer, String(result.score));
});
