import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `vite build --mode webresource` emits one self-contained index.html (scripts,
// styles and fonts inlined) so the app can be stored as a single Dataverse web
// resource. The default build keeps separate assets for a code app.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), ...(mode === "webresource" ? [viteSingleFile()] : [])],
  build: mode === "webresource" ? { outDir: "dist-webresource", assetsInlineLimit: 100_000_000 } : {},
  server: { port: 5173, strictPort: false },
}));
