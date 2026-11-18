import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri serves the built assets from `dist` (see src-tauri/tauri.conf.json > build.frontendDist)
// and expects the dev server on a fixed port so devUrl never has to guess.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // Tauri ships a real Chromium/WebKitGTK, not a legacy browser.
    target: "chrome110",
    minify: "esbuild",
    sourcemap: false,
  },
});
