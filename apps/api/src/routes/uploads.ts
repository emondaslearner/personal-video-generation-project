import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { env } from "../lib/env.js";
import { assertValidProjectId } from "../lib/project-paths.js";
import { recordProjectAsset } from "../services/project-assets.js";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const CATEGORIES = {
  frames: { directory: "frames", extensions: [".png", ".jpg", ".jpeg", ".webp"], mime: ["image/png", "image/jpeg", "image/webp"] },
  references: { directory: "references", extensions: [".png", ".jpg", ".jpeg", ".webp"], mime: ["image/png", "image/jpeg", "image/webp"] },
  audio: { directory: "audio", extensions: [".wav", ".mp3", ".m4a", ".ogg"], mime: ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/ogg"] },
  music: { directory: "music", extensions: [".wav", ".mp3", ".m4a", ".ogg"], mime: ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/ogg"] },
  "sound-effects": { directory: "sound-effects", extensions: [".wav", ".mp3", ".m4a", ".ogg"], mime: ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/ogg"] },
} as const;

type Category = keyof typeof CATEGORIES;

export async function uploadRoutes(app: FastifyInstance) {
  app.post<{ Params: { projectId: string; category: string } }>(
    "/projects/:projectId/assets/:category",
    async (request, reply) => {
      let projectId: string;
      try {
        projectId = assertValidProjectId(request.params.projectId);
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid project id" });
      }

      const category = request.params.category as Category;
      if (!(category in CATEGORIES)) {
        return reply.code(400).send({ error: "Unsupported asset category" });
      }

      const policy = CATEGORIES[category];
      let part;
      try {
        part = await request.file({ limits: { files: 1, fields: 0, fileSize: MAX_FILE_SIZE } });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 413 || (error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
          return reply.code(413).send({ error: "File exceeds the 50 MB upload limit" });
        }
        return reply.code(400).send({ error: "Invalid multipart upload" });
      }
      if (!part) return reply.code(400).send({ error: "A single file is required" });

      const extension = path.extname(part.filename).toLowerCase();
      if (!(policy.extensions as readonly string[]).includes(extension) ||
          !(policy.mime as readonly string[]).includes(part.mimetype.toLowerCase())) {
        part.file.resume();
        return reply.code(415).send({ error: "File type is not allowed for this asset category" });
      }

      const projectRoot = path.join(env.projectsDir, projectId);
      const categoryDir = path.join(projectRoot, policy.directory);
      let temporaryPath: string | undefined;
      let finalPath: string | undefined;

      try {
        const [realRoot, realCategoryDir] = await Promise.all([
          fs.realpath(projectRoot),
          fs.realpath(categoryDir),
        ]);
        const expectedCategoryDir = path.resolve(realRoot, policy.directory);
        if (realCategoryDir !== expectedCategoryDir) {
          return reply.code(400).send({ error: "Invalid asset destination" });
        }

        const filename = `${randomUUID()}${extension}`;
        finalPath = path.join(realCategoryDir, filename);
        temporaryPath = path.join(realCategoryDir, `.${filename}.upload`);
        await pipeline(part.file, createWriteStream(temporaryPath, { flags: "wx" }));

        if (part.file.truncated) {
          await fs.unlink(temporaryPath).catch(() => undefined);
          return reply.code(413).send({ error: "File exceeds the 50 MB upload limit" });
        }

        await fs.rename(temporaryPath, finalPath);
        const relativePath = `${policy.directory}/${filename}`;
        await recordProjectAsset(projectId, category, relativePath);

        // If this is a character reference, attach it to the first profile missing a path
        if (category === "references") {
          try {
            const { getProject, saveProject } = await import("../services/projects.js");
            const project = await getProject(projectId);
            const profiles = [...(project.production?.characterProfiles ?? [])];
            const idx = profiles.findIndex((c) => !c.referenceImagePath);
            if (idx >= 0) {
              profiles[idx] = { ...profiles[idx], referenceImagePath: relativePath };
              await saveProject({
                ...project,
                production: {
                  ...project.production,
                  characterProfiles: profiles,
                },
              });
            }
          } catch {
            // non-fatal — file is still stored
          }
        }

        return reply.code(201).send({
          asset: { category, path: relativePath, filename, size: (await fs.stat(finalPath)).size, mimeType: part.mimetype },
        });
      } catch (error) {
        if (temporaryPath) await fs.unlink(temporaryPath).catch(() => undefined);
        if (finalPath) await fs.unlink(finalPath).catch(() => undefined);
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          return reply.code(404).send({ error: "Project or asset directory not found" });
        }
        request.log.error({ err: error }, "Failed to upload project asset");
        return reply.code(500).send({ error: "Failed to upload asset" });
      }
    },
  );
}
