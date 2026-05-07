"use strict";

const fs = require("fs");
const path = require("path");

describe("manifest permissions and schema", () => {
  test("does not declare unsupported chat permission or chat_protocols property", () => {
    const manifestPath = path.resolve(__dirname, "../../src/manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    expect(manifest.permissions).not.toContain("chat");
    expect(manifest).not.toHaveProperty("chat_protocols");
  });
});
