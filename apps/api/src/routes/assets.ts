import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../lib/env.js";
import { resolveProjectAssetPath } from "../lib/project-paths.js";

/**
 * Serves project assets for Studio preview.
 * Project JSON stores relative paths; the Player uses:
 *   assetBaseUrl + "/" + relativePath
 * Final Remotion renders resolve the same relative paths against the project directory on disk.
 */
export async function assetRoutes(app: FastifyInstance) {
  app.get<{ Params: { projectId: string; "*": string } }>(
    "/assets/:projectId/*",
    async (request, reply) => {
      let resolved: ReturnType<typeof resolveProjectAssetPath>;

      try {
        resolved = resolveProjectAssetPath(
          env.projectsDir,
          request.params.projectId,
          request.params["*"] ?? "",
        );
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Invalid asset path",
        });
      }

      try {
        const [realProjectRoot, realAssetPath] = await Promise.all([
          fs.realpath(resolved.projectRoot),
          fs.realpath(resolved.absolutePath),
        ]);
        const relative = path.relative(realProjectRoot, realAssetPath);

        if (
          !relative ||
          relative.startsWith(`..${path.sep}`) ||
          relative === ".." ||
          path.isAbsolute(relative)
        ) {
          return reply.code(400).send({ error: "Invalid asset path" });
        }

        const stat = await fs.stat(realAssetPath);
        if (!stat.isFile()) {
          return reply.code(404).send({ error: "Asset not found" });
        }

        return reply.sendFile(path.basename(realAssetPath), path.dirname(realAssetPath));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          return reply.code(404).send({ error: "Asset not found" });
        }
        request.log.error({ err: error }, "Failed to serve project asset");
        return reply.code(500).send({ error: "Failed to serve asset" });
      }
    },
  );
}
