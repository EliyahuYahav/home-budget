import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "sync/**/*.test.mjs"],
    // Generating the RSA keys in the sealing tests can take several seconds on a busy machine.
    testTimeout: 30_000,
  },
});
