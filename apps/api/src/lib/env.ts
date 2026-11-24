import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load from monorepo root
config({ path: path.resolve(__dirname, "../../../../.env") });

export const env = {
  // 8787 is reserved by the local MCP authentication proxy on this machine.
  port: Number(process.env.PORT ?? 8788),
  host: process.env.HOST ?? "0.0.0.0",
  projectsDir: path.resolve(
    process.env.PROJECTS_DIR ?? path.resolve(__dirname, "../../../../projects"),
  ),
  kokoroBaseUrl: process.env.KOKORO_BASE_URL ?? "http://localhost:8880",
  kokoroApiKey: process.env.KOKORO_API_KEY ?? "",
  // Secrets — never sent to the client
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite",
  cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
};
