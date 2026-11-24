import { randomUUID } from "node:crypto";
import {
  ProductionPackageSchema,
  type ProductionPackage,
  type ProductionIntake,
  type NodeValidationResult,
  type Project,
  type GeminiVerificationReport,
  resolutionForAspectRatio} from "@framewright/shared";
import { getProject, saveProject } from "./projects.js";
import { runGeminiGatekeeper } from "./gemini.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureSceneIds(pkg: ProductionPackage): ProductionPackage {
  return {
    ...pkg,
    scenes: pkg.scenes.map((scene, index) => ({
      ...scene,
      id:
        scene.id ??
        `scene_${String(scene.number).padStart(2, "0")}_${randomUUID().slice(0, 8)}`,
      number: scene.number || index + 1,
    })),
  };
}

/** Pure deterministic validation (no Gemini). */
export function validateProductionPackage(
  pkg: unknown,
): { package?: ProductionPackage; result: NodeValidationResult } {
  const parsed = ProductionPackageSchema.safeParse(pkg);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    }));
    return {
      result: {
        valid: false,
        errors,
        warnings: [],
      },
    };
  }

  const errors: NodeValidationResult["errors"] = [];
  const warnings: NodeValidationResult["warnings"] = [];
  const data = parsed.data;

  // Sequential scene numbers starting at 1
  const numbers = data.scenes.map((s) => s.number);
  const expected = data.scenes.map((_, i) => i + 1);
  if (JSON.stringify(numbers) !== JSON.stringify(expected)) {
    errors.push({
      path: "scenes",
      message: `Scene numbers must be sequential starting from 1. Found: [${numbers.join(", ")}]`,
    });
  }

  // Duplicate character IDs
  const charIds = data.characterProfiles.map((c) => c.id);
  const duplicateChars = charIds.filter((id, i) => charIds.indexOf(id) !== i);
  if (duplicateChars.length > 0) {
    errors.push({
      path: "characterProfiles",
      message: `Duplicate character ids: ${[...new Set(duplicateChars)].join(", ")}`,
    });
  }

  data.scenes.forEach((scene, idx) => {
    if (scene.originalNarration.trim().length < 10) {
      warnings.push({
        path: `scenes[${idx}].originalNarration`,
        message: "Narration is very short – consider expanding for better pacing.",
      });
    }
    if (scene.visualPrompt.trim().length < 20) {
      warnings.push({
        path: `scenes[${idx}].visualPrompt`,
        message: "Visual prompt is quite short – more detail usually improves image quality.",
      });
    }
  });

  if (data.characterProfiles.length === 0) {
    warnings.push({
      path: "characterProfiles",
      message: "No character profiles provided. Character consistency will be harder to maintain.",
    });
  }

  return {
    package: data,
    result: {
      valid: errors.length === 0,
      errors,
      warnings,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Store the user’s original production package (immutable). */
export async function submitProductionPackage(
  projectId: string,
  rawPackage: unknown,
): Promise<{ project: Project; intake: ProductionIntake }> {
  const { package: pkg, result } = validateProductionPackage(rawPackage);

  if (!pkg || !result.valid) {
    const message =
      result.errors.map((e) => `${e.path}: ${e.message}`).join("; ") ||
      "Invalid production package";
    throw Object.assign(new Error(message), {
      statusCode: 400,
      details: result,
    });
  }

  const normalized = ensureSceneIds(pkg);
  const project = await getProject(projectId);

  if (project.productionIntake?.originalSubmission) {
    throw Object.assign(
      new Error(
        "A production package has already been submitted. Use the reset endpoint first if you want to replace it.",
      ),
      { statusCode: 409 },
    );
  }

  const intake: ProductionIntake = {
    originalSubmission: normalized,
    approvedByUser: false,
  };

  const updated: Project = {
    ...project,
    productionIntake: intake,
    project: {
      ...project.project,
      title: normalized.projectInfo.title || project.project.title,
      description:
        normalized.projectInfo.description ?? project.project.description,
      aspectRatio: normalized.projectInfo.aspectRatio,
      resolution: resolutionForAspectRatio(normalized.projectInfo.aspectRatio),
    },
    story: {
      ...project.story,
      language: normalized.projectInfo.language || project.story.language,
      targetDurationSeconds:
        normalized.projectInfo.targetDurationSeconds ??
        project.story.targetDurationSeconds,
    },
  };

  const saved = await saveProject(updated);
  return { project: saved, intake };
}

/** Run pure Node.js validation on the currently stored original package (or a provided one). */
export async function validateStoredPackage(
  projectId: string,
  rawPackage?: unknown,
): Promise<NodeValidationResult> {
  const project = await getProject(projectId);

  const source =
    rawPackage ??
    project.productionIntake?.originalSubmission ??
    project.productionIntake?.approvedPackage;

  if (!source) {
    throw Object.assign(
      new Error("No production package found to validate. Submit one first."),
      { statusCode: 400 },
    );
  }

  const { result } = validateProductionPackage(source);
  return result;
}

/**
 * Full verification pipeline:
 * 1. Node.js deterministic validation
 * 2. Gemini 3.1 Flash-Lite (or current Flash) creative gatekeeper
 */
export async function verifyProductionPackage(projectId: string): Promise<{
  project: Project;
  nodeValidation: NodeValidationResult;
  geminiReport?: GeminiVerificationReport;
}> {
  const project = await getProject(projectId);
  const original = project.productionIntake?.originalSubmission;

  if (!original) {
    throw Object.assign(
      new Error("No original production package submitted yet."),
      { statusCode: 400 },
    );
  }

  const { package: pkg, result: nodeValidation } =
    validateProductionPackage(original);

  if (!pkg) {
    throw Object.assign(new Error("Stored package failed re-validation"), {
      statusCode: 500,
      details: nodeValidation,
    });
  }

  // Mark as running (optional future use)
  const submittedAt = new Date().toISOString();

  // Run Gemini gatekeeper only if Node.js validation passed
  let geminiReport: GeminiVerificationReport | undefined;
  let proposedPackage: ProductionPackage | undefined;

  if (nodeValidation.valid) {
    const geminiResult = await runGeminiGatekeeper(pkg);
    geminiReport = geminiResult.report;
    proposedPackage = geminiResult.proposedPackage;
  } else {
    geminiReport = {
      summary: "Skipped Gemini gatekeeper because Node.js validation failed.",
      issues: [],
    };
  }

  const verification = {
    status: nodeValidation.valid ? ("completed" as const) : ("failed" as const),
    submittedAt,
    completedAt: new Date().toISOString(),
    nodeValidation,
    geminiReport,
    proposedPackage,
  };

  const updated: Project = {
    ...project,
    productionIntake: {
      ...project.productionIntake!,
      verification,
    },
  };

  const saved = await saveProject(updated);
  return { project: saved, nodeValidation, geminiReport };
}

/** Approve the production package (original or a provided override). */
export async function approveProductionPackage(
  projectId: string,
  options: {
    useProposed?: boolean;
    package?: unknown;
  } = {},
): Promise<{ project: Project; approvedPackage: ProductionPackage }> {
  const project = await getProject(projectId);
  const intake = project.productionIntake;

  if (!intake?.originalSubmission) {
    throw Object.assign(
      new Error("No production package has been submitted yet."),
      { statusCode: 400 },
    );
  }

  let candidate: ProductionPackage;

  if (options.package) {
    const { package: parsed, result } = validateProductionPackage(options.package);
    if (!parsed || !result.valid) {
      throw Object.assign(new Error("Provided package failed validation"), {
        statusCode: 400,
        details: result,
      });
    }
    candidate = ensureSceneIds(parsed);
  } else if (options.useProposed && intake.verification?.proposedPackage) {
    candidate = intake.verification.proposedPackage;
  } else {
    candidate = intake.originalSubmission;
  }

  const { result } = validateProductionPackage(candidate);
  if (!result.valid) {
    throw Object.assign(new Error("Package is not valid for approval"), {
      statusCode: 400,
      details: result,
    });
  }

  const approvedAt = new Date().toISOString();
  const aspectRatio = candidate.projectInfo.aspectRatio;
  const updated: Project = {
    ...project,
    project: {
      ...project.project,
      title: candidate.projectInfo.title || project.project.title,
      description:
        candidate.projectInfo.description ?? project.project.description,
      aspectRatio,
      resolution: resolutionForAspectRatio(aspectRatio),
    },
    story: {
      ...project.story,
      language: candidate.projectInfo.language || project.story.language,
      targetDurationSeconds:
        candidate.projectInfo.targetDurationSeconds ??
        project.story.targetDurationSeconds,
    },
    productionIntake: {
      ...intake,
      approvedPackage: candidate,
      approvedAt,
      approvedByUser: true,
    },
    validation: {
      status: "ready",
      issues: [],
    },
  };

  const saved = await saveProject(updated);
  return { project: saved, approvedPackage: candidate };
}

/** Clear verification + approval, keep original submission. */
export async function resetProductionIntake(
  projectId: string,
): Promise<Project> {
  const project = await getProject(projectId);

  if (!project.productionIntake) {
    return project;
  }

  const updated: Project = {
    ...project,
    productionIntake: {
      originalSubmission: project.productionIntake.originalSubmission,
      approvedByUser: false,
    },
    validation: {
      status: "pending",
      issues: [],
    },
  };

  return saveProject(updated);
}
