import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["server/index.ts", "server/migrate.ts", "server/seed.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist/server",
  clean: false,
  // Bundle @trucea/shared inline so production Node.js doesn't try to
  // import raw .ts source files at runtime.
  noExternal: ["@trucea/shared"],
});
