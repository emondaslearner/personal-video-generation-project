import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Project, StoryVideoProps, Scene } from "@framewright/shared";
import { getProject } from "./projects.js";
import { env } from "../lib/env.js";
import { assertValidProjectId } from "../lib/project-paths.js";


/** Resolve monorepo story-video-engine directory (not relative to cwd). */
function resolveStoryVideoEngineDir(): string {
  if (process.env.STORY_VIDEO_ENGINE_DIR) {
    return path.resolve(process.env.STORY_VIDEO_ENGINE_DIR);
  }

  // export-video.ts lives at apps/api/src/services or apps/api/dist/services
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // apps/api/src/services -> ../../../../story-video-engine
    path.resolve(here, "../../../../story-video-engine"),
    // apps/api/dist/services -> ../../../../story-video-engine
    path.resolve(here, "../../../story-video-engine"),
    // from projectsDir parent (only correct when PROJECTS_DIR is monorepo/projects)
    path.resolve(env.projectsDir, "..", "story-video-engine"),
    // cwd fallbacks
    path.resolve(process.cwd(), "story-video-engine"),
    path.resolve(process.cwd(), "..", "story-video-engine"),
    path.resolve(process.cwd(), "../..", "story-video-engine"),
  ];

  for (const dir of candidates) {
    const cliJs = path.join(dir, "node_modules", "@remotion", "cli", "remotion-cli.js");
    if (fsSync.existsSync(cliJs)) {
      return dir;
    }
  }

  // Return the most likely path for a clearer error message
  return candidates[0];
}

function compositionDuration(scenes: Scene[]): number {
  if (!scenes.length) return 30;
  let cursor = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const next = scenes[i + 1];
    if (!next) {
      cursor += scene.durationInFrames;
      break;
    }
    const t = next.transition;
    const type = t?.type ?? "cut";
    const d = t?.durationInFrames ?? 0;
    const max = Math.max(1, Math.floor(next.durationInFrames / 2));
    const dur = type !== "cut" && d > 0 ? Math.min(d, max) : 0;
    if (type === "crossfade" && dur > 0) {
      cursor += scene.durationInFrames - dur;
    } else if (type === "fade" && dur > 0) {
      cursor += scene.durationInFrames + dur;
    } else {
      cursor += scene.durationInFrames;
    }
  }
  return Math.max(30, cursor);
}

export type ExportOptions = {
  /** Optional filename stem (no extension) */
  name?: string;
  /** Music bed volume 0–1 (defaults to project settings or 0.22) */
  musicVolume?: number;
};

export type ExportResult = {
  status: "completed" | "failed";
  outputPath?: string; // relative to project root, e.g. exports/export_xxx.mp4
  absolutePath?: string;
  durationInFrames?: number;
  sizeBytes?: number;
  error?: string;
  logTail?: string;
};

function requireRenderableProject(project: Project): void {
  if (!project.productionIntake?.approvedByUser || !project.productionIntake.approvedPackage) {
    throw Object.assign(
      new Error("Project must have an approved production package before export."),
      { statusCode: 400 },
    );
  }
  if (!project.scenes || project.scenes.length === 0) {
    throw Object.assign(
      new Error("Project has no scenes. Generate narration (and preferably images) first."),
      { statusCode: 400 },
    );
  }
}

/**
 * Convert relative asset paths to absolute filesystem paths so Remotion
 * can load them during headless render.
 */
function absolutizeScenes(project: Project, projectRoot: string): Scene[] {
  return project.scenes.map((scene) => {
    const next = { ...scene };
    if (scene.image?.path && !path.isAbsolute(scene.image.path)) {
      next.image = {
        ...scene.image,
        path: path.join(projectRoot, scene.image.path),
      };
    }
    if (scene.audio?.path && !path.isAbsolute(scene.audio.path)) {
      next.audio = {
        ...scene.audio,
        path: path.join(projectRoot, scene.audio.path),
      };
    }
    if (scene.soundEffects?.length) {
      next.soundEffects = scene.soundEffects.map((sfx) =>
        path.isAbsolute(sfx) ? sfx : path.join(projectRoot, sfx),
      );
    }
    return next;
  });
}


/**
 * Copy project media into story-video-engine/public/fw-export/<id>/
 * so Remotion staticFile() can serve them during render.
 */
async function stageProjectAssets(
  project: Project,
  projectRoot: string,
  engineDir: string,
): Promise<string> {
  const stageRel = `fw-export/${project.project.id}`;
  const stageAbs = path.join(engineDir, "public", stageRel);
  await fs.mkdir(stageAbs, { recursive: true });

  const copyOne = async (rel: string | undefined) => {
    if (!rel) return;
    const cleaned = stripLeadingSlash(
      toProjectRelative(rel, project.project.id) || rel,
    );
    if (!cleaned || cleaned.includes("..")) return;
    const src = path.isAbsolute(rel)
      ? rel
      : path.join(projectRoot, cleaned);
    const dest = path.join(stageAbs, cleaned);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fs.copyFile(src, dest);
    } catch (err) {
      // skip missing optional assets
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  };

  for (const scene of project.scenes ?? []) {
    await copyOne(scene.image?.path);
    await copyOne(scene.audio?.path);
    for (const sfx of scene.soundEffects ?? []) {
      await copyOne(sfx);
    }
  }
  await copyOne(project.assets?.music?.[0]);

  return stageRel;
}

function buildProps(
  project: Project,
  stagePrefix: string,
  musicVolume?: number,
): StoryVideoProps {
  const settingsVol = (project.settings as { musicVolume?: number } | undefined)?.musicVolume;
  const resolvedVolume =
    typeof musicVolume === "number" && Number.isFinite(musicVolume)
      ? Math.max(0, Math.min(1, musicVolume))
      : typeof settingsVol === "number" && Number.isFinite(settingsVol)
        ? Math.max(0, Math.min(1, settingsVol))
        : 0.22;

  // Relative paths only — Remotion serves them via --public-dir=<projectRoot>
  const scenes = (project.scenes ?? []).map((scene) => {
    const next = { ...scene };
    if (scene.image?.path) {
      const rel = toProjectRelative(scene.image.path, project.project.id) || scene.image.path;
      next.image = { ...scene.image, path: `${stagePrefix}/${stripLeadingSlash(rel)}` };
    }
    if (scene.audio?.path) {
      const rel = toProjectRelative(scene.audio.path, project.project.id) || scene.audio.path;
      next.audio = { ...scene.audio, path: `${stagePrefix}/${stripLeadingSlash(rel)}` };
    }
    if (scene.soundEffects?.length) {
      next.soundEffects = scene.soundEffects.map((sfx) => {
        const rel = toProjectRelative(sfx, project.project.id) || sfx;
        return `${stagePrefix}/${stripLeadingSlash(rel)}`;
      });
    }
    return next;
  });

  let musicPath = project.assets?.music?.[0];
  if (musicPath) {
    musicPath = `${stagePrefix}/${stripLeadingSlash(
      toProjectRelative(musicPath, project.project.id) || musicPath,
    )}`;
  }

  return {
    projectId: project.project.id,
    title: project.project.title,
    width: project.project.resolution.width,
    height: project.project.resolution.height,
    fps: project.project.fps || 30,
    assetMode: "render",
    scenes,
    musicPath,
    musicVolume: resolvedVolume,
  };
}

function stripLeadingSlash(p: string): string {
  return p.replace(/^[\/]+/, "").split(String.fromCharCode(92)).join("/");
}

/** Best-effort: turn an absolute path under projects/<id>/ into a relative asset path. */
function toProjectRelative(absolutePath: string, projectId: string): string | null {
  if (!absolutePath) return null;
  const normalized = absolutePath.split(String.fromCharCode(92)).join("/");
  const looksAbsolute =
    path.isAbsolute(absolutePath) || /^[A-Za-z]:\//.test(normalized);
  if (!looksAbsolute) {
    return normalized.replace(/^\/+/, "");
  }
  const marker = `/projects/${projectId}/`;
  const idx = normalized.toLowerCase().lastIndexOf(marker.toLowerCase());
  if (idx >= 0) {
    return normalized.slice(idx + marker.length);
  }
  const idToken = `/${projectId}/`;
  const idIdx = normalized.toLowerCase().lastIndexOf(idToken.toLowerCase());
  if (idIdx >= 0) {
    return normalized.slice(idIdx + idToken.length);
  }
  return null;
}

function runRemotionRender(args: {
  entry: string;
  compositionId: string;
  output: string;
  propsPath: string;
  width: number;
  height: number;
  cwd: string;
  publicDir?: string;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Run the CLI via node + remotion-cli.js.
    // Spawning remotion.cmd with shell:false causes spawn EINVAL on Windows.
    const cliJs = path.join(
      args.cwd,
      "node_modules",
      "@remotion",
      "cli",
      "remotion-cli.js",
    );

    if (!fsSync.existsSync(cliJs)) {
      resolve({
        code: 1,
        stdout: "",
        stderr: `Remotion CLI not found at ${cliJs}. Run npm install in story-video-engine.`,
      });
      return;
    }

    // Normalize paths for the CLI (forward slashes avoid Windows parsing issues)
    const propsArg = args.propsPath.split(String.fromCharCode(92)).join("/");
    const outputArg = args.output.split(String.fromCharCode(92)).join("/");

    // Raise V8 heap for Remotion (default ~2GB OOMs on 1080x1920 multi-scene renders).
    // concurrency=1 reduces peak memory during frame rendering.
    const heapMb = process.env.REMOTION_MAX_OLD_SPACE_SIZE || "8192";
    const concurrency = process.env.REMOTION_CONCURRENCY || "1";

    const cliArgs = [
      `--max-old-space-size=${heapMb}`,
      cliJs,
      "render",
      args.entry,
      args.compositionId,
      outputArg,
      `--props=${propsArg}`,
      `--concurrency=${concurrency}`,
      "--log=verbose",
      "--overwrite",
    ];

    const child = spawn(process.execPath, cliArgs, {
      cwd: args.cwd,
      env: {
        ...process.env,
        REMOTION_GL: process.env.REMOTION_GL || "swangle",
      },
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      resolve({
        code: 1,
        stdout,
        stderr: stderr + "\n" + (err instanceof Error ? err.message : String(err)),
      });
    });
  });
}

/**
 * Render the project to an MP4 under projects/<id>/exports/.
 */
export async function exportProjectVideo(
  projectId: string,
  options: ExportOptions = {},
): Promise<ExportResult> {
  assertValidProjectId(projectId);
  const project = await getProject(projectId);
  requireRenderableProject(project);

  const projectRoot = path.join(env.projectsDir, projectId);
  const exportsDir = path.join(projectRoot, "exports");
  await fs.mkdir(exportsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const stem = (options.name || `export_${stamp}_${randomUUID().slice(0, 6)}`).replace(
    /[^a-zA-Z0-9_\-]/g,
    "_",
  );
  const relativeOutput = `exports/${stem}.mp4`;
  const absoluteOutput = path.join(projectRoot, relativeOutput);

  const engineDir = resolveStoryVideoEngineDir();
  const stagePrefix = await stageProjectAssets(project, projectRoot, engineDir);
  const props = buildProps(project, stagePrefix, options.musicVolume);
  const propsPath = path.join(exportsDir, `${stem}.props.json`);
  await fs.writeFile(propsPath, JSON.stringify(props, null, 2), "utf8");

  // Locate the Remotion package workspace (monorepo root, not apps/api)
    const entry = path.join("src", "index.ts");

  const result = await runRemotionRender({
    entry,
    compositionId: "StoryVideo",
    output: absoluteOutput,
    propsPath,
    width: props.width,
    height: props.height,
    cwd: engineDir,
  });

  // Clean up props file (keep on failure for debugging)
  if (result.code === 0) {
    await fs.unlink(propsPath).catch(() => undefined);
  }

  if (result.code !== 0) {
    const combined = `${result.stdout || ""}
${result.stderr || ""}`;
    const logTail = combined.slice(-4000);
    // Persist full log next to the attempted export for debugging
    const logPath = path.join(exportsDir, `${stem}.log`);
    await fs.writeFile(logPath, combined, "utf8").catch(() => undefined);
    return {
      status: "failed",
      error: `Remotion render exited with code ${result.code}`,
      logTail,
    };
  }

  let sizeBytes = 0;
  try {
    const stat = await fs.stat(absoluteOutput);
    sizeBytes = stat.size;
  } catch {
    return {
      status: "failed",
      error: "Render reported success but output file is missing",
    };
  }

  // Persist the volume used for this export so Studio can restore it later
  if (typeof options.musicVolume === "number" && Number.isFinite(options.musicVolume)) {
    try {
      const { saveProject } = await import("./projects.js");
      const vol = Math.max(0, Math.min(1, options.musicVolume));
      project.settings = { ...(project.settings ?? {}), musicVolume: vol };
      await saveProject(project);
    } catch {
      // non-fatal – export itself succeeded
    }
  }

  return {
    status: "completed",
    outputPath: relativeOutput,
    absolutePath: absoluteOutput,
    durationInFrames: compositionDuration(project.scenes),
    sizeBytes,
  };
}
