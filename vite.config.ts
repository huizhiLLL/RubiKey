import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  resolve: {
    alias: {
      "@renderer": path.resolve(__dirname, "app/renderer"),
      "@shared": path.resolve(__dirname, "app/shared")
    }
  }
});
