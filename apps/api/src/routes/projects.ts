import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ProjectSchema } from "@framewright/shared";
import {
  listProjects,
  getProject,
  createProject,
  saveProject,
} from "../services/projects.js";

const CreateProjectBodySchema = z
  .object({
    id: z.string().trim().optional(),
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export async function projectRoutes(app: FastifyInstance) {
  /** List all projects (validated summaries). */
  app.get("/projects", async (_request, reply) => {
    try {
      const projects = await listProjects();
      return { projects };
    } catch (error) {
      app.log.error({ err: error }, "Failed to list projects");
      const message =
        error instanceof Error ? error.message : "Failed to list projects";
      return reply.code(500).send({
        error: "Failed to list projects",
        detail: message,
        projectsDir: process.env.PROJECTS_DIR || "(default)",
      });
    }
  });

  /** Create a new empty project. */
  app.post<{ Body: unknown }>("/projects", async (request, reply) => {
    const parsed = CreateProjectBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid project payload",
        details: parsed.error.flatten(),
      });
    }

    const id = parsed.data.id || `project_${randomUUID().slice(0, 12)}`;
    const title = parsed.data.title || "Untitled Project";

    try {
      const project = await createProject(id, title);
      return reply.code(201).send({ project });
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
      const message = error instanceof Error ? error.message : "Failed to create project";
      if (statusCode >= 500) app.log.error({ err: error }, "Failed to create project");
      return reply.code(statusCode).send({ error: message });
    }
  });

  /** Get a full project by id. */
  app.get<{ Params: { id: string } }>("/projects/:id", async (request, reply) => {
    try {
      const project = await getProject(request.params.id);
      return { project };
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
      const message = error instanceof Error ? error.message : "Failed to load project";
      if (statusCode >= 500) app.log.error({ err: error }, "Failed to load project");
      return reply.code(statusCode).send({ error: message });
    }
  });

  /** Save / update an existing project. */
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/projects/:id",
    async (request, reply) => {
      const parsed = ProjectSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid project payload",
          details: parsed.error.flatten(),
        });
      }

      if (parsed.data.project.id !== request.params.id) {
        return reply
          .code(400)
          .send({ error: "Project id in body does not match URL" });
      }

      try {
        const project = await saveProject(parsed.data);
        return { project };
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
        const message = error instanceof Error ? error.message : "Failed to save project";
        if (statusCode >= 500) app.log.error({ err: error }, "Failed to save project");
        return reply.code(statusCode).send({ error: message });
      }
    },
  );
}
