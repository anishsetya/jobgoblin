// Vite setup for the dashboard: React, Tailwind, the "@" alias, and the development proxy.
// The built files go to apps/dashboard/dist, which the local server serves at "/".
// Spec: ARCHITECTURE.md section 12.
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The local server's default address (decision D14). If it had to pick another port, change this line.
const LOCAL_SERVER_ORIGIN = "http://127.0.0.1:47615";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // A fixed port, because the local server only accepts requests from the exact address
    // http://localhost:5173 (see JOBGOBLIN_DEV_ORIGIN in the README). A silent move to 5174 would break it.
    strictPort: true,
    proxy: {
      // The browser talks to Vite, and Vite passes /api on to the local server.
      // changeOrigin rewrites the Host header to 127.0.0.1:47615, which the server's Host check requires.
      "/api": { target: LOCAL_SERVER_ORIGIN, changeOrigin: true },
    },
  },
});
