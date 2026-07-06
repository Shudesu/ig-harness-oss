import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [cloudflare()],
  resolve: {
    // Workspace packages ship `main: ./dist/...` for npm consumers, but on a
    // fresh clone their dist outputs may not exist yet — Vite's resolver then
    // bails before `default: ./src/...` can kick in. Alias both to source so
    // `pnpm --filter worker build` works on a clean tree without requiring a
    // separate `pnpm --filter @ig-harness/{ig-sdk,shared} run build` first.
    alias: {
      "@ig-harness/ig-sdk": path.resolve(
        __dirname,
        "../../packages/ig-sdk/src/index.ts",
      ),
      "@ig-harness/shared": path.resolve(
        __dirname,
        "../../packages/shared/src/index.ts",
      ),
    },
  },
});
