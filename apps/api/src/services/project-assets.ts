import { assertValidProjectId } from "../lib/project-paths.js";
import { getProject, saveProject } from "./projects.js";
import type { Project } from "@framewright/shared";


const assetWriteQueues = new Map<string, Promise<unknown>>();

/** Persist an uploaded asset path in the project's canonical asset index. */
export async function recordProjectAsset(
  id: string,
  category: "frames" | "references" | "audio" | "music" | "sound-effects",
  relativePath: string,
): Promise<Project> {
  assertValidProjectId(id);
  const previous = assetWriteQueues.get(id) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const project = await getProject(id);
    const next: Project = {
      ...project,
      assets: {
        ...project.assets,
        images: category === "frames" || category === "references"
          ? [...new Set([...project.assets.images, relativePath])]
          : project.assets.images,
        audio: category === "audio"
          ? [...new Set([...project.assets.audio, relativePath])]
          : project.assets.audio,
        music: category === "music"
          ? [...new Set([...project.assets.music, relativePath])]
          : project.assets.music,
        soundEffects: category === "sound-effects"
          ? [...new Set([...project.assets.soundEffects, relativePath])]
          : project.assets.soundEffects,
      },
    };
    return saveProject(next);
  });
  assetWriteQueues.set(id, current);
  try {
    return await current;
  } finally {
    if (assetWriteQueues.get(id) === current) assetWriteQueues.delete(id);
  }
}
