import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Project,
  ProductionPackage,
  ProductionScene,
  AudioAsset,
} from "@framewright/shared";
import { getProject, saveProject } from "./projects.js";
import {
  generateSpeech,
  clampSceneSeconds,
  estimateSecondsFromText,
  speedForEmotion,
  voiceForEmotion,
  KOKORO_VOICE_PRESETS,
} from "./kokoro.js";
import { env } from "../lib/env.js";
import { assertValidProjectId } from "../lib/project-paths.js";

export type NarrationGenerateOptions = {
  force?: boolean;
  voiceOverride?: string | null;
  speedOverride?: number | null;
  format?: "wav" | "mp3";
  sceneId?: string; // if set, only this scene
};

export type SceneNarrationResult = {
  sceneId: string;
  number: number;
  status: "generated" | "failed" | "skipped";
  path?: string;
  durationSeconds?: number;
  voice?: string;
  speed?: number;
  error?: string | null;
};

export type NarrationGenerateResult = {
  status: "completed" | "partial" | "failed";
  scenes: SceneNarrationResult[];
  project: Project;
};

function requireApprovedPackage(project: Project): ProductionPackage {
  const pkg = project.productionIntake?.approvedPackage;
  if (!pkg) {
    throw Object.assign(
      new Error(
        "Project has no approved production package. Approve a package before generating narration.",
      ),
      { statusCode: 400 },
    );
  }
  return pkg;
}

function resolveVoice(
  scene: ProductionScene,
  pkg: ProductionPackage,
  override?: string | null,
): string {
  if (override && override.trim()) return override.trim();
  if (scene.voice && scene.voice.trim()) return scene.voice.trim();
  const def = pkg.narrationProfile?.defaultVoice;
  if (def && def.trim()) return def.trim();
  // Emotion-aware default when package/scene omit an explicit voice
  return voiceForEmotion(scene.emotion, KOKORO_VOICE_PRESETS.narrative_warm);
}

function resolveSpeed(
  scene: ProductionScene,
  pkg: ProductionPackage,
  override?: number | null,
): number {
  if (typeof override === "number" && Number.isFinite(override)) {
    return speedForEmotion(scene.emotion, override);
  }
  if (typeof scene.speed === "number" && Number.isFinite(scene.speed)) {
    return speedForEmotion(scene.emotion, scene.speed);
  }
  const def = pkg.narrationProfile?.defaultSpeed;
  const base =
    typeof def === "number" && Number.isFinite(def) ? def : 0.95;
  return speedForEmotion(scene.emotion, base);
}

function sceneAudioPath(sceneNumber: number, format: "wav" | "mp3"): string {
  const short = randomUUID().slice(0, 8);
  const num = String(sceneNumber).padStart(2, "0");
  return `audio/scene_${num}_${short}.${format}`;
}

function fpsOf(project: Project): number {
  return project.project.fps || 30;
}

function framesFromSeconds(seconds: number, fps: number): number {
  return Math.max(1, Math.ceil(seconds * fps));
}

/**
 * Generate narration for all (or one) scenes in an approved project.
 */
export async function generateNarration(
  projectId: string,
  options: NarrationGenerateOptions = {},
): Promise<NarrationGenerateResult> {
  assertValidProjectId(projectId);
  const force = Boolean(options.force);
  const format = options.format === "mp3" ? "mp3" : "wav";

  let project = await getProject(projectId);
  const pkg = requireApprovedPackage(project);

  const targetScenes = options.sceneId
    ? pkg.scenes.filter((s) => s.id === options.sceneId || String(s.number) === options.sceneId)
    : pkg.scenes;

  if (targetScenes.length === 0) {
    throw Object.assign(new Error("No matching scenes found for narration generation"), {
      statusCode: 404,
    });
  }

  const results: SceneNarrationResult[] = [];
  const audioDir = path.join(env.projectsDir, projectId, "audio");
  await fs.mkdir(audioDir, { recursive: true });

  // Work on a mutable copy of scenes that will be written back
  const workingScenes = [...(project.scenes ?? [])];

  for (const prodScene of targetScenes) {
    const sceneId = prodScene.id || `scene_${prodScene.number}`;
    const existing = workingScenes.find(
      (s) => s.id === sceneId || s.number === prodScene.number,
    );

    // Skip if already generated and not forcing
    if (
      !force &&
      existing?.audio?.status === "generated" &&
      existing.audio.path
    ) {
      results.push({
        sceneId,
        number: prodScene.number,
        status: "skipped",
        path: existing.audio.path,
        durationSeconds: existing.audio.durationSeconds,
        voice: existing.audio.voice,
        speed: existing.audio.speed,
        error: null,
      });
      continue;
    }

    const voice = resolveVoice(prodScene, pkg, options.voiceOverride);
    const speed = resolveSpeed(prodScene, pkg, options.speedOverride);
    const spokenText =
      prodScene.productionNarration?.trim() ||
      prodScene.originalNarration?.trim() ||
      "";

    try {
      const speech = await generateSpeech({
        text: spokenText,
        voice,
        speed,
        format,
      });

      const relativePath = sceneAudioPath(prodScene.number, format);
      const absolutePath = path.join(env.projectsDir, projectId, relativePath);
      await fs.writeFile(absolutePath, speech.buffer);

      const safeSeconds = clampSceneSeconds(
        speech.durationSeconds ||
          estimateSecondsFromText(spokenText, speed),
      );

      const audioAsset: AudioAsset = {
        path: relativePath,
        voice: speech.voice,
        speed: speech.speed,
        durationSeconds: safeSeconds,
        status: "generated",
        generatedAt: new Date().toISOString(),
      };

      const durationInFrames = framesFromSeconds(
        safeSeconds,
        fpsOf(project),
      );

      // Upsert into project.scenes
      const sceneIndex = workingScenes.findIndex(
        (s) => s.id === sceneId || s.number === prodScene.number,
      );

      const narrationText =
        prodScene.productionNarration || prodScene.originalNarration;
      const baseScene = {
        id: sceneId,
        number: prodScene.number,
        title: prodScene.title,
        originalNarration: prodScene.originalNarration,
        narration: narrationText,
        emotion: prodScene.emotion,
        narrationInstructions: prodScene.narrationInstructions,
        voice: speech.voice,
        speed: speech.speed,
        camera: prodScene.camera,
        transition: prodScene.transition,
        soundEffects: prodScene.soundEffects ?? [],
        validationStatus: "ok" as const,
        durationInFrames,
        audio: audioAsset,
        // Default subtitle from narration so burn-in works without extra steps
        subtitle: {
          text: narrationText,
          startFrame: 0,
          endFrame: durationInFrames,
        },
      };

      if (sceneIndex >= 0) {
        workingScenes[sceneIndex] = {
          ...workingScenes[sceneIndex],
          ...baseScene,
          // keep existing image if any
          image: workingScenes[sceneIndex].image,
        };
      } else {
        workingScenes.push(baseScene as any);
      }

      // Also keep assets index in sync
      const assets = project.assets ?? {
        images: [],
        audio: [],
        music: [],
        soundEffects: [],
      };
      if (!assets.audio.includes(relativePath)) {
        assets.audio = [...assets.audio, relativePath];
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
        durationSeconds: speech.durationSeconds,
        voice: speech.voice,
        speed: speech.speed,
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

  // Persist once at the end
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

export async function getNarrationStatus(projectId: string) {
  const project = await getProject(projectId);
  const pkg = project.productionIntake?.approvedPackage;

  const scenes = (pkg?.scenes ?? []).map((prodScene) => {
    const sceneId = prodScene.id || `scene_${prodScene.number}`;
    const existing = (project.scenes ?? []).find(
      (s) => s.id === sceneId || s.number === prodScene.number,
    );
    const audio = existing?.audio;
    return {
      sceneId,
      number: prodScene.number,
      title: prodScene.title,
      status: audio?.status ?? "missing",
      path: audio?.path,
      durationSeconds: audio?.durationSeconds,
      voice: audio?.voice,
      speed: audio?.speed,
      generatedAt: audio?.generatedAt,
    };
  });

  return {
    approved: Boolean(pkg),
    scenes,
  };
}

/**
 * Re-measure WAV durations for existing generated audio and fix inflated durationInFrames.
 * Does not call Kokoro — only repairs timing from files already on disk.
 */
export async function repairNarrationDurations(
  projectId: string,
): Promise<{ project: Project; repaired: number; skipped: number }> {
  assertValidProjectId(projectId);
  const project = await getProject(projectId);
  const { measureWavDurationSeconds, clampSceneSeconds, estimateSecondsFromText } =
    await import("./kokoro.js");

  let repaired = 0;
  let skipped = 0;
  const fps = fpsOf(project);
  const scenes = [...(project.scenes ?? [])];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const rel = scene.audio?.path;
    if (!rel || scene.audio?.status !== "generated") {
      skipped++;
      continue;
    }

    const abs = path.join(env.projectsDir, projectId, rel);
    let seconds: number | null = null;
    try {
      const buf = await fs.readFile(abs);
      if (rel.toLowerCase().endsWith(".wav")) {
        seconds = measureWavDurationSeconds(buf);
      }
    } catch {
      seconds = null;
    }

    if (seconds == null || !Number.isFinite(seconds) || seconds > 90 || seconds < 0.25) {
      seconds = estimateSecondsFromText(
        scene.narration || scene.originalNarration || "",
        scene.speed ?? 1,
      );
    }

    seconds = clampSceneSeconds(seconds);
    const durationInFrames = framesFromSeconds(seconds, fps);

    scenes[i] = {
      ...scene,
      durationInFrames,
      audio: scene.audio
        ? { ...scene.audio, durationSeconds: seconds }
        : scene.audio,
      subtitle: scene.subtitle
        ? { ...scene.subtitle, endFrame: durationInFrames }
        : scene.subtitle,
    };
    repaired++;
  }

  const saved = await saveProject({ ...project, scenes });
  return { project: saved, repaired, skipped };
}
