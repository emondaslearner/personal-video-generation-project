import { buildApp } from "./app.js";
import { env } from "./lib/env.js";

const app = await buildApp();

try {
  await app.listen({ port: env.port, host: env.host });
  app.log.info(`Framewright API listening on http://${env.host}:${env.port}`);
  app.log.info(`Projects directory: ${env.projectsDir}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
