import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  resolve: {
    alias: {
      // Workspace package – explicit path avoids Windows resolution issues
      "@framewright/shared": path.resolve(
        __dirname,
        "../../packages/shared/dist/index.js",
      ),
      // Allow Studio to import the same StoryVideo composition source
      "@remotion-comp": path.resolve(__dirname, "../../story-video-engine/src"),
    },
  },
});
