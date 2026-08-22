import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL ?? "http://localhost:3000",
    video: false,
    screenshotsFolder: "audit/artifacts/cypress/screenshots",
    videosFolder: "audit/artifacts/cypress/videos",
    supportFile: false,
    defaultCommandTimeout: 15000,
    requestTimeout: 30000,
    env: {
      authCookie: process.env.CYPRESS_AUTH_COOKIE ?? "",
      authCookieName: process.env.CYPRESS_AUTH_COOKIE_NAME ?? "app_session_id",
      runLiveStorage: process.env.CYPRESS_RUN_LIVE_STORAGE === "true",
    },
  },
});
