import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  submitProductionPackage,
  validateStoredPackage,
  verifyProductionPackage,
  approveProductionPackage,
  resetProductionIntake,
} from "../services/production-intake.js";
import {
  generateNarration,
  repairNarrationDurations,
  getNarrationStatus,
} from "../services/narration-generation.js";
import {
  generateImages,
  getImageStatus,
} from "../services/image-generation.js";
import { exportProjectVideo } from "../services/export-video.js";
import { runGeminiDecision } from "../services/gemini-decision.js";
import { DecisionRequestSchema } from "@framewright/shared";

const ApproveBodySchema = z
  .object({
    useProposed: z.boolean().optional(),
    package: z.unknown().optional(),
  })
  .strict();

export async function productionRoutes(app: FastifyInstance) {
  /** Submit (or re-submit after reset) the original production package. */
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/projects/:id/production/intake",
    async (request, reply) => {
      try {
        const body = request.body as { package?: unknown } | unknown;
        const rawPackage =
          body && typeof body === "object" && "package" in body
            ? (body as { package: unknown }).package
            : body;

        const { project, intake } = await submitProductionPackage(
          request.params.id,
          rawPackage,
        );

        return reply.code(201).send({
          status: "submitted",
          originalSubmission: intake.originalSubmission,
          projectId: project.project.id,
          message: "Production package stored as original submission",
        });
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Failed to submit package";
        const details = (error as { details?: unknown })?.details;

        if (statusCode >= 500) {
          app.log.error({ err: error }, "Failed to submit production package");
        }

        return reply.code(statusCode).send({
          error: message,
          details,
        });
      }
    },
  );

  /** Run pure Node.js validation. */
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/projects/:id/production/validate",
    async (request, reply) => {
      try {
        const body = request.body as { package?: unknown } | undefined;
        const result = await validateStoredPackage(
          request.params.id,
          body?.package,
        );

        return {
          status: result.valid ? "validated" : "invalid",
          nodeValidation: result,
        };
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Validation failed";

        if (statusCode >= 500) {
          app.log.error({ err: error }, "Production validation failed");
        }

        return reply.code(statusCode).send({ error: message });
      }
    },
  );

  /** Full verification (Node.js + Gemini gatekeeper). */
  app.post<{ Params: { id: string } }>(
    "/projects/:id/production/verify",
    async (request, reply) => {
      try {
        const { project, nodeValidation, geminiReport } =
          await verifyProductionPackage(request.params.id);

        return {
          status: nodeValidation.valid ? "completed" : "failed",
          nodeValidation,
          geminiReport,
          productionIntake: project.productionIntake,
        };
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Verification failed";

        if (statusCode >= 500) {
          app.log.error({ err: error }, "Production verification failed");
        }

        return reply.code(statusCode).send({ error: message });
      }
    },
  );

  /** Approve the package so generation can begin. */
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/projects/:id/production/approve",
    async (request, reply) => {
      const parsed = ApproveBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid approve payload",
          details: parsed.error.flatten(),
        });
      }

      try {
        const { project, approvedPackage } = await approveProductionPackage(
          request.params.id,
          parsed.data,
        );

        return {
          status: "approved",
          approvedAt: project.productionIntake?.approvedAt,
          approvedPackage,
          projectId: project.project.id,
        };
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Approval failed";
        const details = (error as { details?: unknown })?.details;

        if (statusCode >= 500) {
          app.log.error({ err: error }, "Production approval failed");
        }

        return reply.code(statusCode).send({ error: message, details });
      }
    },
  );

  /** Reset verification + approval, keep original submission. */
  app.post<{ Params: { id: string } }>(
    "/projects/:id/production/reset",
    async (request, reply) => {
      try {
        const project = await resetProductionIntake(request.params.id);
        return {
          status: "reset",
          message: "Verification and approval cleared. Original submission retained.",
          productionIntake: project.productionIntake,
        };
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Reset failed";

        if (statusCode >= 500) {
          app.log.error({ err: error }, "Production reset failed");
        }

        return reply.code(statusCode).send({ error: message });
      }
    },
  );


  /** Generate narration for all (or pending) scenes. Requires approved package. */
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/projects/:id/production/generate-narration",
    async (request, reply) => {
      const body = (request.body ?? {}) as {
        force?: boolean;
        voiceOverride?: string | null;
        speedOverride?: number | null;
        format?: "wav" | "mp3";
      };

      try {
        const result = await generateNarration(request.params.id, {
          force: Boolean(body.force),
          voiceOverride: body.voiceOverride,
          speedOverride: body.speedOverride,
          format: body.format === "mp3" ? "mp3" : "wav",
        });

        return result;
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Narration generation failed";

        if (statusCode >= 500) {
          app.log.error({ err: error }, "Narration generation failed");
        }

        return reply.code(statusCode).send({ error: message });
      }
    },
  );

  /** Generate / regenerate narration for a single scene. */
  app.post<{ Params: { id: string; sceneId: string }; Body: unknown }>(
    "/projects/:id/production/generate-narration/:sceneId",
    async (request, reply) => {
      const body = (request.body ?? {}) as {
        force?: boolean;
        voiceOverride?: string | null;
        speedOverride?: number | null;
        format?: "wav" | "mp3";
      };

      try {
        const result = await generateNarration(request.params.id, {
          force: true, // single-scene calls always regenerate
          voiceOverride: body.voiceOverride,
          speedOverride: body.speedOverride,
          format: body.format === "mp3" ? "mp3" : "wav",
          sceneId: request.params.sceneId,
        });

        return result;
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Narration generation failed";

        if (statusCode >= 500) {
          app.log.error({ err: error }, "Single-scene narration generation failed");
        }

        return reply.code(statusCode).send({ error: message });
      }
    },
  );

  /** Current narration generation status per scene. */
  app.get<{ Params: { id: string } }>(
    "/projects/:id/production/narration-status",
    async (request, reply) => {
      try {
        return await getNarrationStatus(request.params.id);
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Failed to load narration status";

        return reply.code(statusCode).send({ error: message });
      }
    },
  );

  /** Generate images for all (or pending) scenes. Requires approved package. */
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/projects/:id/production/generate-images",
    async (request, reply) => {
      const body = (request.body ?? {}) as { force?: boolean };

      try {
        const result = await generateImages(request.params.id, {
          force: Boolean(body.force),
        });

        return result;
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Image generation failed";

        if (statusCode >= 500) {
          app.log.error({ err: error }, "Image generation failed");
        }

        return reply.code(statusCode).send({ error: message });
      }
    },
  );

  /** Generate / regenerate image for a single scene. */
  app.post<{ Params: { id: string; sceneId: string }; Body: unknown }>(
    "/projects/:id/production/generate-images/:sceneId",
    async (request, reply) => {
      const body = (request.body ?? {}) as { force?: boolean };

      try {
        const result = await generateImages(request.params.id, {
          force: true,
          sceneId: request.params.sceneId,
        });

        return result;
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Image generation failed";

        if (statusCode >= 500) {
          app.log.error({ err: error }, "Single-scene image generation failed");
        }

        return reply.code(statusCode).send({ error: message });
      }
    },
  );

  /** Current image generation status per scene. */
  app.get<{ Params: { id: string } }>(
    "/projects/:id/production/image-status",
    async (request, reply) => {
      try {
        return await getImageStatus(request.params.id);
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Failed to load image status";

        return reply.code(statusCode).send({ error: message });
      }
    },
  );

  /** Render final MP4 for an approved project. */
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/projects/:id/production/export",
    async (request, reply) => {
      const body = (request.body ?? {}) as { name?: string; musicVolume?: number };
      try {
        const result = await exportProjectVideo(request.params.id, {
          name: body.name,
          musicVolume: body.musicVolume,
        });

        if (result.status !== "completed") {
          const tail = result.logTail?.trim() || "";
          return reply.code(500).send({
            error: tail
              ? `${result.error || "Export failed"}: ${tail.slice(-800)}`
              : result.error || "Export failed",
            logTail: result.logTail,
          });
        }

        return {
          status: "completed",
          outputPath: result.outputPath,
          downloadUrl: `/assets/${request.params.id}/${result.outputPath}`,
          sizeBytes: result.sizeBytes,
          durationInFrames: result.durationInFrames,
        };
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Export failed";

        if (statusCode >= 500) {
          app.log.error({ err: error }, "Video export failed");
        }

        return reply.code(statusCode).send({ error: message });
      }
    },
  );

  /** Phase 5 – Gemini Decision 1 (bounded yes/no, multiple-choice, or score). */
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/projects/:id/production/decision",
    async (request, reply) => {
      try {
        const parsed = DecisionRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({
            error: "Invalid decision request",
            details: parsed.error.flatten(),
          });
        }

        const result = await runGeminiDecision(parsed.data);

        return {
          status: "decided",
          decision: result,
        };
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Decision failed";

        if (statusCode >= 500) {
          app.log.error({ err: error }, "Gemini Decision 1 failed");
        }

        return reply.code(statusCode).send({ error: message });
      }
    },
  );


  /** List completed MP4 exports for a project. */
  app.get<{ Params: { id: string } }>(
    "/projects/:id/production/exports",
    async (request, reply) => {
      try {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const { env } = await import("../lib/env.js");
        const { assertValidProjectId } = await import("../lib/project-paths.js");

        assertValidProjectId(request.params.id);
        const exportsDir = path.join(env.projectsDir, request.params.id, "exports");

        let entries: { name: string; path: string; sizeBytes: number; mtime: string }[] = [];
        try {
          const files = await fs.readdir(exportsDir);
          for (const name of files) {
            if (!name.endsWith(".mp4")) continue;
            const abs = path.join(exportsDir, name);
            const stat = await fs.stat(abs);
            if (!stat.isFile()) continue;
            entries.push({
              name,
              path: `exports/${name}`,
              sizeBytes: stat.size,
              mtime: stat.mtime.toISOString(),
            });
          }
          entries.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }

        return { exports: entries };
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Failed to list exports";
        return reply.code(statusCode).send({ error: message });
      }
    },
  );


  /** Re-measure existing WAV durations (fixes inflated scene lengths). */
  app.post<{ Params: { id: string } }>(
    "/projects/:id/production/repair-narration-durations",
    async (request, reply) => {
      try {
        const result = await repairNarrationDurations(request.params.id);
        return result;
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message =
          error instanceof Error ? error.message : "Duration repair failed";
        return reply.code(statusCode).send({ error: message });
      }
    },
  );

}
