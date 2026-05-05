// @ts-check
"use strict";

const { test, expect } = require("@playwright/test");

// ---------------------------------------------------------------------------
// Shared page setup helpers
// ---------------------------------------------------------------------------

/** Build the messenger mock init script string with embedded data. */
function messengerScript(storageData = {}, responses = {}) {
  return `
(function() {
  window.__storageData = ${JSON.stringify(storageData)};
  window.__messengerResponses = ${JSON.stringify(responses)};
  window.messenger = {
    runtime: {
      sendMessage: function(msg) {
        var h = window.__messengerResponses[msg.type];
        if (typeof h === 'function') return Promise.resolve(h(msg));
        if (h !== undefined) return Promise.resolve(h);
        return Promise.resolve({});
      },
      openOptionsPage: function() {},
      onMessage: { addListener: function() {} }
    },
    storage: {
      local: {
        get: function() {
          return Promise.resolve(Object.assign({}, window.__storageData));
        },
        set: function(data) {
          Object.assign(window.__storageData, data);
          return Promise.resolve();
        },
        remove: function(keys) {
          var arr = Array.isArray(keys) ? keys : [keys];
          arr.forEach(function(k) { delete window.__storageData[k]; });
          return Promise.resolve();
        }
      },
      onChanged: { addListener: function() {} }
    }
  };
})();
`;
}

async function goToOptions(page, { storageData = {}, responses = {} } = {}) {
  await page.addInitScript(messengerScript(storageData, responses));
  await page.goto("/options.html");
}

async function goToSpace(page, { storageData = {}, responses = {} } = {}) {
  await page.addInitScript(messengerScript(storageData, responses));
  await page.goto("/space.html");
}

// ---------------------------------------------------------------------------
// options.html tests
// ---------------------------------------------------------------------------
test.describe("options.html", () => {
  test("renders Authentication section", async ({ page }) => {
    await goToOptions(page);
    await expect(page.locator("h2").first()).toContainText("Authentication");
  });

  test("renders Display section with disable-avatars checkbox", async ({ page }) => {
    await goToOptions(page);
    const section = page.locator("section").filter({ hasText: "Display" });
    await expect(section).toBeVisible();
    await expect(section.locator("#disable-avatars")).toBeVisible();
  });

  test("renders Required Scopes section", async ({ page }) => {
    await goToOptions(page);
    const section = page.locator("section").filter({ hasText: "Required Scopes" });
    await expect(section).toBeVisible();
  });

  test("disable-avatars checkbox is unchecked by default", async ({ page }) => {
    await goToOptions(page);
    await expect(page.locator("#disable-avatars")).not.toBeChecked();
  });

  test("token input field is present and empty by default", async ({ page }) => {
    await goToOptions(page);
    const input = page.locator("#slack-token");
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("");
  });

  test("Save, Test Connection, and Clear Token buttons are present", async ({ page }) => {
    await goToOptions(page);
    await expect(page.locator("#btn-save")).toBeVisible();
    await expect(page.locator("#btn-test")).toBeVisible();
    await expect(page.locator("#btn-clear")).toBeVisible();
  });

  test("token input is pre-filled when storage has a token", async ({ page }) => {
    await goToOptions(page, { storageData: { slackToken: "xoxb-stored-token" } });
    await expect(page.locator("#slack-token")).toHaveValue("xoxb-stored-token");
  });

  test("disable-avatars checkbox is checked when storage has disableAvatars:true", async ({
    page,
  }) => {
    await goToOptions(page, { storageData: { disableAvatars: true } });
    await expect(page.locator("#disable-avatars")).toBeChecked();
  });

  test("checking disable-avatars saves to storage", async ({ page }) => {
    await goToOptions(page);
    await page.locator("#disable-avatars").check();
    await page.waitForTimeout(200);
    const saved = await page.evaluate(() => window.__storageData.disableAvatars);
    expect(saved).toBe(true);
  });

  test("unchecking disable-avatars saves false to storage", async ({ page }) => {
    await goToOptions(page, { storageData: { disableAvatars: true } });
    await page.locator("#disable-avatars").uncheck();
    await page.waitForTimeout(200);
    const saved = await page.evaluate(() => window.__storageData.disableAvatars);
    expect(saved).toBe(false);
  });

  test("Save Token shows success status when background returns success:true", async ({ page }) => {
    await goToOptions(page, { responses: { set_token: { success: true } } });
    await page.fill("#slack-token", "xoxb-my-token");
    await page.click("#btn-save");
    const status = page.locator("#status-msg");
    await expect(status).toBeVisible();
    await expect(status).toContainText("saved");
  });

  test("Test Connection shows success when auth returns ok:true", async ({ page }) => {
    await goToOptions(page, {
      responses: { test_token: { ok: true, team: "My Workspace", user: "alice" } },
    });
    await page.fill("#slack-token", "xoxb-my-token");
    await page.click("#btn-test");
    const status = page.locator("#status-msg");
    await expect(status).toBeVisible();
    await expect(status).toContainText("My Workspace");
  });

  test("Test Connection shows error when auth returns ok:false", async ({ page }) => {
    await goToOptions(page, {
      responses: { test_token: { ok: false, error: "invalid_auth" } },
    });
    await page.fill("#slack-token", "xoxb-bad");
    await page.click("#btn-test");
    const status = page.locator("#status-msg");
    await expect(status).toBeVisible();
    await expect(status).toContainText("invalid_auth");
  });

  test("Clear Token clears the token input", async ({ page }) => {
    await goToOptions(page, {
      storageData: { slackToken: "xoxb-existing" },
      responses: { set_token: { success: true } },
    });
    await page.click("#btn-clear");
    await expect(page.locator("#slack-token")).toHaveValue("");
  });

  test("renders Rate Limiting section with rate-limited-mode checkbox", async ({ page }) => {
    await goToOptions(page);
    const section = page.locator("section").filter({ hasText: "Rate Limiting" });
    await expect(section).toBeVisible();
    await expect(section.locator("#rate-limited-mode")).toBeVisible();
  });

  test("rate-limited-mode checkbox is unchecked by default", async ({ page }) => {
    await goToOptions(page);
    await expect(page.locator("#rate-limited-mode")).not.toBeChecked();
  });

  test("rate-limited-mode checkbox is checked when storage has rateLimitedMode:true", async ({
    page,
  }) => {
    await goToOptions(page, { storageData: { rateLimitedMode: true } });
    await expect(page.locator("#rate-limited-mode")).toBeChecked();
  });

  test("checking rate-limited-mode saves to storage", async ({ page }) => {
    await goToOptions(page);
    await page.locator("#rate-limited-mode").check();
    await page.waitForTimeout(200);
    const saved = await page.evaluate(() => window.__storageData.rateLimitedMode);
    expect(saved).toBe(true);
  });

  test("unchecking rate-limited-mode saves false to storage", async ({ page }) => {
    await goToOptions(page, { storageData: { rateLimitedMode: true } });
    await page.locator("#rate-limited-mode").uncheck();
    await page.waitForTimeout(200);
    const saved = await page.evaluate(() => window.__storageData.rateLimitedMode);
    expect(saved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// space.html tests
// ---------------------------------------------------------------------------
test.describe("space.html", () => {
  test("shows auth panel when no token is configured", async ({ page }) => {
    await goToSpace(page, { responses: { get_token: { token: null } } });
    await expect(page.locator("#auth-panel")).not.toHaveClass(/hidden/);
    await expect(page.locator("#main-panel")).toHaveClass(/hidden/);
  });

  test("shows main panel when token is set", async ({ page }) => {
    await goToSpace(page, {
      responses: {
        get_token: { token: "SET" },
        get_channels: { channels: [] },
        get_unread: { unreadChannels: [] },
      },
    });
    await expect(page.locator("#main-panel")).not.toHaveClass(/hidden/);
  });

  test("Open Settings button is visible in the auth panel (no token)", async ({ page }) => {
    await goToSpace(page, { responses: { get_token: { token: null } } });
    await expect(page.locator("#btn-open-settings")).toBeVisible();
  });

  test("channel list renders joined channels", async ({ page }) => {
    await goToSpace(page, {
      responses: {
        get_token: { token: "SET" },
        get_channels: {
          channels: [
            { id: "C001", name: "general", is_member: true, is_private: false },
            { id: "C002", name: "random", is_member: true, is_private: false },
            { id: "C003", name: "not-joined", is_member: false, is_private: false },
          ],
        },
        get_unread: { unreadChannels: [] },
      },
    });
    const channelList = page.locator("#channel-list");
    await expect(channelList.locator(".channel-item")).toHaveCount(2);
    await expect(channelList).toContainText("general");
    await expect(channelList).toContainText("random");
    await expect(channelList).not.toContainText("not-joined");
  });

  test("unread channel gets unread CSS class", async ({ page }) => {
    await goToSpace(page, {
      responses: {
        get_token: { token: "SET" },
        get_channels: {
          channels: [{ id: "C001", name: "general", is_member: true, is_private: false }],
        },
        get_unread: { unreadChannels: ["C001"] },
      },
    });
    const item = page.locator(".channel-item").filter({ hasText: "general" });
    await expect(item).toHaveClass(/unread/);
  });

  test("selecting a channel loads messages", async ({ page }) => {
    await goToSpace(page, {
      responses: {
        get_token: { token: "SET" },
        get_channels: {
          channels: [{ id: "C001", name: "general", is_member: true, is_private: false }],
        },
        get_unread: { unreadChannels: [] },
        get_messages: {
          messages: [
            { ts: "1700000001.000", user: "U001", text: "Hello channel!", type: "message" },
          ],
        },
        get_user: {
          user: {
            id: "U001",
            real_name: "John Doe",
            name: "johndoe",
            profile: { display_name: "johndoe" },
          },
        },
      },
    });
    await page.locator(".channel-item").filter({ hasText: "general" }).click();
    const messagesList = page.locator("#messages-list");
    await expect(messagesList.locator(".message")).toHaveCount(1);
    await expect(messagesList).toContainText("Hello channel!");
  });

  test("channel header updates when a channel is selected", async ({ page }) => {
    await goToSpace(page, {
      responses: {
        get_token: { token: "SET" },
        get_channels: {
          channels: [{ id: "C001", name: "general", is_member: true, is_private: false }],
        },
        get_unread: { unreadChannels: [] },
        get_messages: { messages: [] },
      },
    });
    await page.locator(".channel-item").filter({ hasText: "general" }).click();
    await expect(page.locator("#channel-label")).toContainText("general");
  });

  test("messages show avatar placeholder (initials) when disableAvatars is true", async ({
    page,
  }) => {
    await goToSpace(page, {
      storageData: { disableAvatars: true },
      responses: {
        get_token: { token: "SET" },
        get_channels: {
          channels: [{ id: "C001", name: "general", is_member: true, is_private: false }],
        },
        get_unread: { unreadChannels: [] },
        get_messages: {
          messages: [{ ts: "1700000001.000", user: "U001", text: "hi", type: "message" }],
        },
        get_user: {
          user: {
            id: "U001",
            real_name: "John Doe",
            name: "johndoe",
            profile: { display_name: "johndoe", image_48: "https://example.com/avatar.png" },
          },
        },
      },
    });
    await page.locator(".channel-item").filter({ hasText: "general" }).click();
    const avatar = page.locator(".message .avatar-placeholder").first();
    await expect(avatar).toBeVisible();
    await expect(avatar).toContainText("JD");
  });

  test("messages show img avatar when disableAvatars is false", async ({ page }) => {
    await goToSpace(page, {
      storageData: { disableAvatars: false },
      responses: {
        get_token: { token: "SET" },
        get_channels: {
          channels: [{ id: "C001", name: "general", is_member: true, is_private: false }],
        },
        get_unread: { unreadChannels: [] },
        get_messages: {
          messages: [{ ts: "1700000001.000", user: "U001", text: "hi", type: "message" }],
        },
        get_user: {
          user: {
            id: "U001",
            real_name: "John Doe",
            name: "johndoe",
            profile: { display_name: "johndoe", image_48: "https://example.com/avatar.png" },
          },
        },
      },
    });
    await page.locator(".channel-item").filter({ hasText: "general" }).click();
    const img = page.locator(".message .message-avatar img").first();
    await expect(img).toBeVisible();
  });
});
