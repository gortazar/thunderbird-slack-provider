// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:3456",
    headless: true,
  },
  webServer: {
    command: "node tests/e2e/server.js",
    port: 3456,
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
});
