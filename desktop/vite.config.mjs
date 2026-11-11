import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(desktopDirectory, "..");

export default defineConfig({
  root: path.join(desktopDirectory, "ui"),
  publicDir: path.join(projectRoot, "public"),
  envDir: false,
  envPrefix: "SECDASH_DESKTOP_PUBLIC_",
  plugins: [react()],
  resolve: {
    alias: { "@": projectRoot },
  },
  build: {
    outDir: path.join(desktopDirectory, "build", "ui"),
    emptyOutDir: true,
  },
});
