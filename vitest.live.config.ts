import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "tests/integration/live-apisix-opa-enforcement.test.ts",
      "server/middleware/trace-context.test.ts",
      "server/security/opa-permify-client.test.ts",
      "server/integration/exceljs-uuid-compat.test.ts",
      "tests/backend/paymentRepository.integration.test.ts",
      "tests/backend/payment-router-security.integration.test.ts",
    ],
    setupFiles: [],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
