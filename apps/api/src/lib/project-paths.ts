import path from "node:path";

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function assertValidProjectId(id: string): string {
  if (!PROJECT_ID_PATTERN.test(id)) {
    throw Object.assign(new Error("Invalid project id"), { statusCode: 400 });
  }
  return id;
}

export function resolveProjectAssetPath(
  projectsRoot: string,
  projectId: string,
  assetPath: string,
): { projectRoot: string; absolutePath: string } {
  assertValidProjectId(projectId);

  if (!assetPath || assetPath.includes("\0")) {
    throw new Error("Invalid asset path");
  }

  // Normalize both slash styles so Windows traversal is rejected on every platform.
  const portablePath = assetPath.replace(/\\/g, "/");
  if (portablePath.startsWith("/") || /^[a-zA-Z]:/.test(portablePath)) {
    throw new Error("Absolute asset paths are not allowed");
  }

  const segments = portablePath.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || !segment)) {
    throw new Error("Invalid asset path");
  }

  const projectRoot = path.resolve(projectsRoot, projectId);
  const absolutePath = path.resolve(projectRoot, ...segments);
  const relative = path.relative(projectRoot, absolutePath);

  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Invalid asset path");
  }

  return { projectRoot, absolutePath };
}
