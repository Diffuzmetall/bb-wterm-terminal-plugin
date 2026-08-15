import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@bb/plugin-sdk": fileURLToPath(
        new URL("./test/plugin-sdk-stub.ts", import.meta.url),
      ),
    },
  },
  test: { environment: "node" },
});
