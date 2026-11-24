import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { env } from "./lib/env.js";
import { healthRoutes } from "./routes/health.js";
import { assetRoutes } from "./routes/assets.js";
import { projectRoutes } from "./routes/projects.js";
import { uploadRoutes } from "./routes/uploads.js";
import { productionRoutes } from "./routes/production.js";
import { ensureProjectsRoot } from "./services/projects.js";
import { SCHEMA_VERSION } from "@framewright/shared";

export async function buildApp() {
  const app = Fastify({ logger: false });

  await ensureProjectsRoot();

  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 0 },
  });

  await app.register(cors, {
    origin: true,
  });

  await app.register(fastifyStatic, {
    root: env.projectsDir,
    serve: false,
  });

  await app.register(healthRoutes);
  await app.register(assetRoutes);
  await app.register(projectRoutes);
  await app.register(uploadRoutes);
  await app.register(productionRoutes);

  app.get("/", async () => ({
    name: "Framewright API",
    schemaVersion: SCHEMA_VERSION,
    docs: {
      health: "/health",
      kokoro: "/health/kokoro",
      secrets: "/health/secrets",
      assets: "/assets/:projectId/*",
      upload: "POST /projects/:projectId/assets/:category (multipart field: file; max 50 MB)",
      projects: "/projects",
      productionIntake: "POST /projects/:id/production/intake",
      productionValidate: "POST /projects/:id/production/validate",
      productionVerify: "POST /projects/:id/production/verify",
      productionApprove: "POST /projects/:id/production/approve",
      productionReset: "POST /projects/:id/production/reset",
    },
  }));

  return app;
}
