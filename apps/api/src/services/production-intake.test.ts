import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectsRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "framewright-production-tests-"),
);
process.env.PROJECTS_DIR = projectsRoot;
// Ensure Gemini is not called during tests (no key)
process.env.GEMINI_API_KEY = "";

const {
  createProject,
  getProject,
} = await import("./projects.js");

const {
  submitProductionPackage,
  validateStoredPackage,
  verifyProductionPackage,
  approveProductionPackage,
  resetProductionIntake,
  validateProductionPackage,
} = await import("./production-intake.js");

after(async () => {
  await fs.rm(projectsRoot, { recursive: true, force: true });
});

/** Minimal valid ProductionPackage for tests */
function makeValidPackage(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "2.1-package",
    projectInfo: {
      title: "Test Story",
      aspectRatio: "9:16",
      language: "en",
      targetDurationSeconds: 45,
    },
    visualStyle: {
      overallStyle: "cinematic",
      negativePrompt: "blurry",
    },
    characterProfiles: [
      {
        id: "char_01",
        name: "Hero",
        appearance: "young adult",
      },
    ],
    narrationProfile: {
      defaultVoice: "af_heart",
      defaultSpeed: 1.0,
      defaultEmotion: "calm",
    },
    musicProfile: {
      mood: "atmospheric",
    },
    globalInstructions: "Keep pacing slow and atmospheric.",
    scenes: [
      {
        number: 1,
        title: "Opening",
        originalNarration:
          "In the quiet hours before dawn, the forest held its breath.",
        productionNarration:
          "In the quiet hours before dawn, the forest held its breath.",
        visualPrompt:
          "A misty forest at dawn, soft golden light filtering through tall pine trees, cinematic lighting, highly detailed",
        emotion: "calm",
        durationHintSeconds: 8,
      },
      {
        number: 2,
        title: "Discovery",
        originalNarration:
          "A soft glow appeared between the trees, drawing the traveler closer.",
        productionNarration:
          "A soft glow appeared between the trees, drawing the traveler closer.",
        visualPrompt:
          "A mysterious soft blue glow between dark trees in a forest, atmospheric fog, cinematic, high detail",
        emotion: "curious",
        durationHintSeconds: 10,
      },
    ],
    ...overrides,
  };
}

test("validateProductionPackage accepts a well-formed package", () => {
  const { package: pkg, result } = validateProductionPackage(makeValidPackage());
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.ok(pkg);
  assert.equal(pkg!.scenes.length, 2);
});

test("validateProductionPackage rejects missing required fields and bad scene numbers", () => {
  const bad = makeValidPackage({
    scenes: [
      {
        number: 3, // not sequential from 1
        originalNarration: "short",
        productionNarration: "short",
        visualPrompt: "too short",
      },
    ],
  });

  const { result } = validateProductionPackage(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "scenes"));
});

test("submit → validate → verify → approve → reset happy path", async () => {
  const project = await createProject("prod_flow_test", "Production Flow");
  const projectId = project.project.id;

  // 1. Submit
  const { intake } = await submitProductionPackage(
    projectId,
    makeValidPackage(),
  );
  assert.ok(intake.originalSubmission);
  assert.equal(intake.approvedByUser, false);
  assert.equal(intake.originalSubmission.scenes.length, 2);
  // Scene IDs should be auto-generated
  assert.ok(intake.originalSubmission.scenes[0].id);

  // 2. Validate stored package
  const validation = await validateStoredPackage(projectId);
  assert.equal(validation.valid, true);

  // 3. Verify (Node.js + Gemini skipped because no key)
  const { nodeValidation, geminiReport } =
    await verifyProductionPackage(projectId);
  assert.equal(nodeValidation.valid, true);
  assert.ok(geminiReport);
  assert.match(geminiReport.summary, /Gemini API key is not configured/i);

  const afterVerify = await getProject(projectId);
  assert.equal(afterVerify.productionIntake?.verification?.status, "completed");

  // 4. Approve original
  const { approvedPackage } = await approveProductionPackage(projectId, {});
  assert.equal(approvedPackage.projectInfo.title, "Test Story");
  assert.equal(approvedPackage.scenes.length, 2);

  const afterApprove = await getProject(projectId);
  assert.equal(afterApprove.productionIntake?.approvedByUser, true);
  assert.ok(afterApprove.productionIntake?.approvedAt);
  assert.equal(afterApprove.validation.status, "ready");

  // 5. Reset keeps original, clears verification + approval
  const afterReset = await resetProductionIntake(projectId);
  assert.ok(afterReset.productionIntake?.originalSubmission);
  assert.equal(afterReset.productionIntake?.approvedByUser, false);
  assert.equal(afterReset.productionIntake?.approvedPackage, undefined);
  assert.equal(afterReset.productionIntake?.verification, undefined);
  assert.equal(afterReset.validation.status, "pending");
});

test("submit rejects invalid package with 400-style error", async () => {
  const project = await createProject("prod_invalid_test", "Invalid Package");

  await assert.rejects(
    async () =>
      submitProductionPackage(project.project.id, {
        schemaVersion: "2.1-package",
        projectInfo: { title: "X", aspectRatio: "9:16" },
        scenes: [], // min 1 required
      }),
    (err: unknown) => {
      const e = err as { statusCode?: number; message?: string };
      assert.equal(e.statusCode, 400);
      return true;
    },
  );
});

test("submit rejects second submission without reset (409)", async () => {
  const project = await createProject("prod_dup_submit", "Duplicate Submit");
  const projectId = project.project.id;

  await submitProductionPackage(projectId, makeValidPackage());

  await assert.rejects(
    async () => submitProductionPackage(projectId, makeValidPackage()),
    (err: unknown) => {
      const e = err as { statusCode?: number };
      assert.equal(e.statusCode, 409);
      return true;
    },
  );
});

test("approve can use proposed package when present", async () => {
  const project = await createProject("prod_propose_test", "Propose Test");
  const projectId = project.project.id;

  await submitProductionPackage(projectId, makeValidPackage());
  await verifyProductionPackage(projectId);

  // Manually inject a proposed package (simulating Gemini)
  const current = await getProject(projectId);
  const proposed = makeValidPackage({
    projectInfo: {
      title: "Improved Title from Gemini",
      aspectRatio: "9:16",
      language: "en",
    },
  });

  const { saveProject } = await import("./projects.js");
  await saveProject({
    ...current,
    productionIntake: {
      ...current.productionIntake!,
      verification: {
        ...current.productionIntake!.verification!,
        proposedPackage: proposed as any,
      },
    },
  });

  const { approvedPackage } = await approveProductionPackage(projectId, {
    useProposed: true,
  });

  assert.equal(approvedPackage.projectInfo.title, "Improved Title from Gemini");
});

test("verify fails cleanly when no package has been submitted", async () => {
  const project = await createProject("prod_no_pkg", "No Package");

  await assert.rejects(
    async () => verifyProductionPackage(project.project.id),
    (err: unknown) => {
      const e = err as { statusCode?: number };
      assert.equal(e.statusCode, 400);
      return true;
    },
  );
});
