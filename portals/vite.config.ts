import { build as esbuild } from "esbuild";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import os from "node:os";
import path from "node:path";

/**
 * Compile the Portals server script into the bundle root.
 *
 * Portals looks for `server.js` beside index.html and runs it as an invisible
 * authoritative participant in every session. It has to be a single file with
 * no import/require, which is exactly what an IIFE bundle is - and building it
 * from TypeScript is what lets the referee share duel-protocol.ts with the
 * clients instead of a hand-copied second rulebook that drifts.
 *
 * A closeBundle hook rather than a separate command: `vite build` empties the
 * output directory, so anything written beforehand is deleted, and a build
 * step people have to remember is a build step that gets forgotten.
 */
function portalsServerScript(): Plugin {
  return {
    name: "portals-server-script",
    apply: "build",
    async closeBundle() {
      await esbuild({
        entryPoints: [path.resolve(__dirname, "server/server-entry.ts")],
        outfile: path.resolve(__dirname, "dist/server.js"),
        bundle: true,
        format: "iife",
        target: "es2022",
        platform: "neutral",
        legalComments: "none",
        banner: { js: "// GENERATED from portals/server/*.ts by the portals-server-script plugin in portals/vite.config.ts. Portals runs this as the session referee; it ships publicly." },
      });
    },
  };
}
export default defineConfig({
  base: "./",
  // Vite swaps its optimized-dependency directory by renaming a temp folder
  // over it. A file syncing client holding a handle on that folder fails the
  // rename with EBUSY, which leaves the pre-bundle half-written and the Rapier
  // WASM permanently unresolved, so the scene never mounts. Keeping the cache
  // outside the synced tree removes the contention entirely.
  cacheDir: path.join(os.tmpdir(), "make-it-worse-vite"),
  publicDir: path.resolve(__dirname, "../public"),
  define: {
    "process.env.NEXT_PUBLIC_ASSET_BASE": JSON.stringify("./"),
  },
  plugins: [react(), portalsServerScript()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "..") },
    // The shared game components live at the repo root and resolve three from
    // the root node_modules, while this workspace resolves its own copy. Two
    // instances of three or fiber in one bundle make the R3F reconciler render
    // nothing at all, with no error: <Canvas> mounts but no child ever renders.
    dedupe: [
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "@react-three/rapier",
      "react",
      "react-dom",
    ],
  },
  server: { fs: { allow: [path.resolve(__dirname, "..")] } },
  build: {
    target: "es2022",
    outDir: "dist",
    assetsDir: "assets",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Keep the largest engine payloads stable and independently cacheable.
        // Leave the R3F adapters to Rollup: forcing interdependent adapters into
        // separate chunks creates a cycle that Vite must preload with the shell.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@dimforge/rapier")) return "rapier";
          if (id.includes("/three/")) return "three";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          )
            return "react";
          return undefined;
        },
      },
    },
  },
});
