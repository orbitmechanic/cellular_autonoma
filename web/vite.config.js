import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the built site works from a GitHub Pages project subpath
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist" },
});
