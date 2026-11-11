import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite builds the client of the built version (`bun run build` → dist/). A
// development run does not use Vite: the Bun server bundles the client itself
// (src/server/main.ts), so the App stays one process (Module Standard).
export default defineConfig({
  root: "src/ui",
  plugins: [react()],
  // No .env* files anywhere (Module Standard, MS-07).
  envDir: false,
  build: { outDir: "../../dist", emptyOutDir: true },
});
