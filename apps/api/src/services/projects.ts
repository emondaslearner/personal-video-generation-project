import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ProjectSchema,
  createEmptyProject,
  type Project,
} from "@framewright/shared";
import { env } from "../lib/env.js";
import { assertValidProjectId } from "../lib/project-paths.js";

const PROJECT_JSON = "project.json";

function projectDir(id: string): string {
  assertValidProjectId(id);
  return path.join(env.projectsDir, id);
}

function projectJsonPath(id: string): string {
  return path.join(projectDir(id), PROJECT_JSON);
}

async function writeProjectAtomically(filePath: string, project: Project): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;

  try {
    await fs.writeFile(temporaryPath, JSON.stringify(project, null, 2), {
      encoding: "utf-8",
      flag: "wx",
    });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/** Ensure the root projects directory exists. */
export async function ensureProjectsRoot(): Promise<void> {
  await fs.mkdir(env.projectsDir, { recursive: true });
}

/** List validated project summaries (id + title + updatedAt). */
export async function listProjects(): Promise<
  Array<{ id: string; title: string; updatedAt?: string; aspectRatio?: string }>
> {
  await ensureProjectsRoot();
  const entries = await fs.readdir(env.projectsDir, { withFileTypes: true });
  const results: Array<{
    id: string;
    title: string;
    updatedAt?: string;
    aspectRatio?: string;
  }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    try {
      const raw = await fs.readFile(projectJsonPath(entry.name), "utf-8");
      const parsed = ProjectSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || parsed.data.project.id !== entry.name) continue;

      results.push({
        id: parsed.data.project.id,
        title: parsed.data.project.title,
        updatedAt: parsed.data.project.updatedAt,
        aspectRatio: parsed.data.project.aspectRatio,
      });
    } catch {
      // Skip directories that are not valid projects.
    }
  }

  results.sort((a, b) =>
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  );
  return results;
}

/** Load a full project by id. Throws if missing or invalid. */
export async function getProject(id: string): Promise<Project> {
  const filePath = projectJsonPath(id);
  let raw: string;

  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw Object.assign(new Error(`Project not found: ${id}`), {
        statusCode: 404,
      });
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error(`Invalid project JSON: ${id}`), {
      statusCode: 500,
    });
  }

  const result = ProjectSchema.safeParse(parsed);
  if (!result.success || result.data.project.id !== id) {
    throw Object.assign(
      new Error(`Project schema validation failed: ${id}`),
      { statusCode: 500 },
    );
  }

  return result.data;
}

/** Create a new empty project without overwriting an existing directory. */
export async function createProject(
  id: string,
  title = "Untitled Project",
): Promise<Project> {
  assertValidProjectId(id);
  await ensureProjectsRoot();

  const dir = projectDir(id);
  try {
    // Non-recursive mkdir makes creation atomic and prevents duplicate IDs racing.
    await fs.mkdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw Object.assign(new Error(`Project already exists: ${id}`), {
        statusCode: 409,
      });
    }
    throw error;
  }

  const project = createEmptyProject(id, title);

  try {
    await Promise.all(
      ["frames", "audio", "references", "music", "sound-effects", "exports"].map(
        (directory) => fs.mkdir(path.join(dir, directory)),
      ),
    );
    await writeProjectAtomically(projectJsonPath(id), project);
    return project;
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/** Save an existing project atomically. Updates updatedAt. */
export async function saveProject(project: Project): Promise<Project> {
  const id = assertValidProjectId(project.project.id);
  const dir = projectDir(id);

  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) throw new Error("Project path is not a directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw Object.assign(new Error(`Project not found: ${id}`), {
        statusCode: 404,
      });
    }
    throw error;
  }

  const updated: Project = {
    ...project,
    project: {
      ...project.project,
      updatedAt: new Date().toISOString(),
    },
  };

  const result = ProjectSchema.safeParse(updated);
  if (!result.success) {
    throw Object.assign(new Error("Project schema validation failed on save"), {
      statusCode: 400,
      details: result.error.flatten(),
    });
  }

  await writeProjectAtomically(projectJsonPath(id), result.data);
  return result.data;
}
