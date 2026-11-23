import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The build keeps vite.config.ts; vitest reads this file first.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
    testTimeout: 20000,
  },
});
