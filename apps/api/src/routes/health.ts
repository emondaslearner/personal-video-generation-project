import type { FastifyInstance } from "fastify";
import { checkKokoroConnectivity } from "../services/kokoro.js";
import { checkFluxConnectivity } from "../services/flux.js";
import { env } from "../lib/env.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "framewright-api",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/health/kokoro", async () => {
    const result = await checkKokoroConnectivity();
    return {
      ...result,
      note: result.reachable
        ? "Kokoro is reachable from the API process."
        : "Kokoro is NOT reachable from this environment. If it runs on Windows while the API is in WSL/Docker, use host.docker.internal or the host LAN IP instead of localhost.",
      configuredBaseUrl: env.kokoroBaseUrl,
    };
  });

  app.get("/health/flux", async () => {
    const result = await checkFluxConnectivity();
    return {
      ...result,
      note: result.accountConfigured
        ? "Cloudflare credentials are present. Actual generation requires available Workers AI neurons."
        : "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the monorepo root .env",
    };
  });

  /** Confirms secrets stay server-side (only presence flags, never values). */
  app.get("/health/secrets", async () => {
    return {
      geminiApiKeyConfigured: Boolean(env.geminiApiKey),
      cloudflareConfigured: Boolean(
        env.cloudflareAccountId && env.cloudflareApiToken,
      ),
      kokoroApiKeyConfigured: Boolean(env.kokoroApiKey),
    };
  });
}
