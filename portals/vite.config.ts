import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  base: "./",
  publicDir: path.resolve(__dirname, "../public"),
  define: {
    "process.env.NEXT_PUBLIC_ASSET_BASE": JSON.stringify("./"),
  },
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "..") } },
  server: { fs: { allow: [path.resolve(__dirname, "..")] } },
  build: {
    target: "es2022",
    outDir: "dist",
    assetsDir: "assets",
    emptyOutDir: true,
  },
});
