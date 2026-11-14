import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxyTarget = "http://127.0.0.1:3877";

export default defineConfig({
  plugins: [react()],
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": proxyTarget,
      "/mcp": proxyTarget,
      "/health": proxyTarget,
    },
  },
});
