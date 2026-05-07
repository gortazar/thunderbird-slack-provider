"use strict";

const fs = require("fs");
const path = require("path");

describe("manifest chat protocol declaration", () => {
  test("declares Slack chat protocol with iconURL and does not require chat permission", () => {
    const manifestPath = path.resolve(__dirname, "../../src/manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    expect(manifest.permissions).not.toContain("chat");
    expect(Array.isArray(manifest.chat_protocols)).toBe(true);
    expect(manifest.chat_protocols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Slack",
          iconURL: "icons/slack-96.svg",
        }),
      ])
    );
  });
});
