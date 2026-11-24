import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Project,
  ProductionPackage,
  ProductionScene,
  ImageAsset,
} from "@framewright/shared";
import { getProject, saveProject } from "./projects.js";
import { generateImage, buildImagePrompt } from "./flux.js";
import { env } from "../lib/env.js";
import { assertValidProjectId } from "../lib/project-paths.js";

export type ImageGenerateOptions = {
  force?: boolean;
  sceneId?: string;
};

export type SceneImageResult = {
  sceneId: string;
  number: number;
  status: "generated" | "failed" | "skipped";
  path?: string;
  width?: number;
  height?: number;
  error?: string | null;
};

export type ImageGenerateResult = {
  status: "completed" | "partial" | "failed";
  scenes: SceneImageResult[];
  project: Project;
};

function requireApprovedPackage(project: Project): ProductionPackage {
  const pkg = project.productionIntake?.approvedPackage;
  if (!pkg) {
    throw Object.assign(
      new Error(
        "Project has no approved production package. Approve a package before generating images.",
      ),
      { statusCode: 400 },
    );
  }
  return pkg;
}

function sceneImagePath(sceneNumber: number): string {
  const short = randomUUID().slice(0, 8);
  const num = String(sceneNumber).padStart(2, "0");
  return `frames/scene_${num}_${short}.png`;
}

/** Compact visual identity lines for FLUX (avoid long essays). */
function characterNotesFromPackage(pkg: ProductionPackage): string[] {
  return (pkg.characterProfiles ?? [])
    .map((c) => {
      const bits: string[] = [];
      if (c.name) bits.push(c.name);
      // Prefer short visual traits; trim each field to keep prompt focused
      const trim = (s?: string, max = 120) =>
        s && s.trim() ? (s.trim().length > max ? s.trim().slice(0, max) : s.trim()) : "";
      const appearance = trim(c.appearance, 140);
      const clothing = trim(c.clothing, 100);
      const features = trim(c.distinguishingFeatures, 80);
      if (appearance) bits.push(appearance);
      if (clothing) bits.push(clothing);
      if (features) bits.push(features);
      return bits.filter(Boolean).join(", ");
    })
    .filter(Boolean);
}

/** Prefer characters mentioned in the scene prompt; fall back to all. */
function charactersForScene(
  pkg: ProductionPackage,
  sceneVisualPrompt: string,
): string[] {
  const all = characterNotesFromPackage(pkg);
  if (all.length <= 1) return all;
  const lower = (sceneVisualPrompt || "").toLowerCase();
  const mentioned = (pkg.characterProfiles ?? [])
    .filter((c) => c.name && lower.includes(c.name.toLowerCase()))
    .map((c) => {
      const notes = characterNotesFromPackage({
        ...pkg,
        characterProfiles: [c],
      } as ProductionPackage);
      return notes[0];
    })
    .filter(Boolean) as string[];
  return mentioned.length > 0 ? mentioned : all.slice(0, 2);
}

async function loadReferenceBuffers(
  projectId: string,
  pkg: ProductionPackage,
  project?: Project,
): Promise<Buffer[]> {
  const buffers: Buffer[] = [];
  const seen = new Set<string>();

  // 1. Character profile paths (production package + project.production)
  const profilePaths: string[] = [];
  for (const c of pkg.characterProfiles ?? []) {
    const rel = (c as { referenceImagePath?: string }).referenceImagePath;
    if (rel) profilePaths.push(rel);
  }
  for (const c of project?.production?.characterProfiles ?? []) {
    if (c.referenceImagePath) profilePaths.push(c.referenceImagePath);
  }

  for (const rel of profilePaths) {
    if (seen.has(rel) || buffers.length >= 4) break;
    try {
      const abs = path.join(env.projectsDir, projectId, rel);
      const buf = await fs.readFile(abs);
      if (buf.length > 100) {
        buffers.push(buf);
        seen.add(rel);
      }
    } catch {
      // ignore
    }
  }

  // 2. Fallback: any files already in references/
  if (buffers.length < 4) {
    try {
      const refDir = path.join(env.projectsDir, projectId, "references");
      const files = await fs.readdir(refDir);
      for (const f of files) {
        if (buffers.length >= 4) break;
        if (f.startsWith(".")) continue;
        const rel = `references/${f}`;
        if (seen.has(rel)) continue;
        try {
          const buf = await fs.readFile(path.join(refDir, f));
          if (buf.length > 100) {
            buffers.push(buf);
            seen.add(rel);
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // no references dir
    }
  }

  return buffers;
}

/**
 * Generate scene images for an approved project using FLUX.2 Klein.
 */
export async function generateImages(
  projectId: string,
  options: ImageGenerateOptions = {},
): Promise<ImageGenerateResult> {
  assertValidProjectId(projectId);
  const force = Boolean(options.force);

  let project = await getProject(projectId);
  const pkg = requireApprovedPackage(project);

  const targetScenes = options.sceneId
    ? pkg.scenes.filter(
        (s) => s.id === options.sceneId || String(s.number) === options.sceneId,
      )
    : pkg.scenes;

  if (targetScenes.length === 0) {
    throw Object.assign(new Error("No matching scenes found for image generation"), {
      statusCode: 404,
    });
  }

  const results: SceneImageResult[] = [];
  const framesDir = path.join(env.projectsDir, projectId, "frames");
  await fs.mkdir(framesDir, { recursive: true });

  const workingScenes = [...(project.scenes ?? [])];
  const referenceBuffers = await loadReferenceBuffers(projectId, pkg, project);

  const targetWidth = project.project.resolution?.width ?? 1080;
  const targetHeight = project.project.resolution?.height ?? 1920;

  for (const prodScene of targetScenes) {
    const sceneId = prodScene.id || `scene_${prodScene.number}`;
    const existing = workingScenes.find(
      (s) => s.id === sceneId || s.number === prodScene.number,
    );

    if (
      !force &&
      existing?.image?.status === "generated" &&
      existing.image.path
    ) {
      results.push({
        sceneId,
        number: prodScene.number,
        status: "skipped",
        path: existing.image.path,
        width: existing.image.width,
        height: existing.image.height,
        error: null,
      });
      continue;
    }

    const { prompt, negativePrompt } = buildImagePrompt({
      sceneVisualPrompt: prodScene.visualPrompt,
      sceneNegativePrompt: prodScene.negativePrompt,
      visualStyle: pkg.visualStyle,
      characterNotes: charactersForScene(pkg, prodScene.visualPrompt),
      // Intentionally omit globalInstructions — narrative prose hurts FLUX image quality
      aspectRatio: pkg.projectInfo?.aspectRatio ?? project.project.aspectRatio,
    });

    try {
      const image = await generateImage({
        prompt,
        negativePrompt,
        width: targetWidth,
        height: targetHeight,
        referenceImages: referenceBuffers.length > 0 ? referenceBuffers : undefined,
      });

      const relativePath = sceneImagePath(prodScene.number);
      const absolutePath = path.join(env.projectsDir, projectId, relativePath);
      await fs.writeFile(absolutePath, image.buffer);

      const imageAsset: ImageAsset = {
        path: relativePath,
        prompt,
        width: image.width,
        height: image.height,
        status: "generated",
      };

      const sceneIndex = workingScenes.findIndex(
        (s) => s.id === sceneId || s.number === prodScene.number,
      );

      const baseScene = {
        id: sceneId,
        number: prodScene.number,
        title: prodScene.title,
        originalNarration: prodScene.originalNarration,
        narration: prodScene.productionNarration || prodScene.originalNarration,
        emotion: prodScene.emotion,
        narrationInstructions: prodScene.narrationInstructions,
        voice: prodScene.voice,
        speed: prodScene.speed,
        camera: prodScene.camera,
        transition: prodScene.transition,
        soundEffects: prodScene.soundEffects ?? [],
        validationStatus: "ok" as const,
        durationInFrames:
          existing?.durationInFrames ??
          Math.max(1, Math.ceil((prodScene.durationHintSeconds ?? 5) * (project.project.fps || 30))),
        image: imageAsset,
        audio: existing?.audio,
      };

      if (sceneIndex >= 0) {
        workingScenes[sceneIndex] = {
          ...workingScenes[sceneIndex],
          ...baseScene,
          audio: workingScenes[sceneIndex].audio ?? existing?.audio,
        };
      } else {
        workingScenes.push(baseScene as any);
      }

      const assets = project.assets ?? {
        images: [],
        audio: [],
        music: [],
        soundEffects: [],
      };
      if (!assets.images.includes(relativePath)) {
        assets.images = [...assets.images, relativePath];
      }

      project = {
        ...project,
        scenes: workingScenes,
        assets,
      };

      results.push({
        sceneId,
        number: prodScene.number,
        status: "generated",
        path: relativePath,
        width: image.width,
        height: image.height,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        sceneId,
        number: prodScene.number,
        status: "failed",
        error: message,
      });
    }
  }

  const saved = await saveProject({
    ...project,
    scenes: workingScenes,
  });

  const generated = results.filter((r) => r.status === "generated").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const status =
    failed === 0 ? "completed" : generated > 0 ? "partial" : "failed";

  return { status, scenes: results, project: saved };
}

export async function getImageStatus(projectId: string) {
  const project = await getProject(projectId);
  const pkg = project.productionIntake?.approvedPackage;

  const scenes = (pkg?.scenes ?? []).map((prodScene) => {
    const sceneId = prodScene.id || `scene_${prodScene.number}`;
    const existing = (project.scenes ?? []).find(
      (s) => s.id === sceneId || s.number === prodScene.number,
    );
    const image = existing?.image;
    return {
      sceneId,
      number: prodScene.number,
      title: prodScene.title,
      status: image?.status ?? "missing",
      path: image?.path,
      width: image?.width,
      height: image?.height,
      prompt: image?.prompt,
    };
  });

  return {
    approved: Boolean(pkg),
    scenes,
  };
}
