import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: false,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: [
        "src/cli.ts",
        "src/log.ts",
        "src/mcp/**",
        "src/db/migrations/**",
      ],
      thresholds: {
        statements: 90,
        functions: 90,
        lines: 90,
        branches: 70,
      },
    },
  },
});
