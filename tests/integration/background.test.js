"use strict";

/**
 * Integration tests for background.js.
 *
 * @jest-environment node
 *
 * background.js uses global `messenger` and `fetch` — both are set up here
 * before the module is required. Each test group calls jest.resetModules() +
 * re-requires the file to get a fresh isolated module state.
 */

const path = require("path");
const BACKGROUND = path.resolve(__dirname, "../../src/background.js");

// Captured listener references
let messageHandler;
let alarmHandler;
let storageChangedHandler;
let mockMessenger;

function createMockMessenger() {
  messageHandler = null;
  alarmHandler = null;
  storageChangedHandler = null;

  return {
    runtime: {
      onInstalled: { addListener: jest.fn() },
      onStartup: { addListener: jest.fn() },
      onMessage: {
        addListener: jest.fn((fn) => {
          messageHandler = fn;
        }),
      },
      sendMessage: jest.fn().mockResolvedValue(undefined),
    },
    storage: {
      local: {
        get: jest.fn().mockResolvedValue({}),
        set: jest.fn().mockResolvedValue({}),
        remove: jest.fn().mockResolvedValue({}),
      },
      onChanged: {
        addListener: jest.fn((fn) => {
          storageChangedHandler = fn;
        }),
      },
    },
    alarms: {
      create: jest.fn(),
      clear: jest.fn(),
      onAlarm: {
        addListener: jest.fn((fn) => {
          alarmHandler = fn;
        }),
      },
    },
    spaces: {
      query: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: "space-1" }),
    },
  };
}

/**
 * Mocks global.fetch so that calls to specific Slack API method names
 * return the provided response bodies.
 *
 * @param {Record<string, object>} responses  key = Slack method name (e.g. "auth.test")
 */
function mockSlackApi(responses) {
  global.fetch = jest.fn().mockImplementation((url) => {
    const urlPath = new URL(url).pathname;
    const method = urlPath.slice(urlPath.lastIndexOf("/") + 1);
    const body = responses[method];
    if (body !== undefined) {
      return Promise.resolve({ json: () => Promise.resolve(body) });
    }
    return Promise.resolve({
      json: () => Promise.resolve({ ok: false, error: "not_mocked" }),
    });
  });
}

/** Loads a fresh copy of background.js into the current module registry. */
function loadBackground() {
  jest.resetModules();
  require(BACKGROUND);
}

beforeEach(() => {
  mockMessenger = createMockMessenger();
  global.messenger = mockMessenger;

  // Ensure fetch exists as a configurable global so jest.spyOn can wrap it.
  // Node 20 has a built-in fetch, but we replace it entirely for test isolation.
  global.fetch = jest.fn().mockResolvedValue({
    json: () => Promise.resolve({ ok: true }),
  });

  loadBackground();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.messenger;
  delete global.fetch;
});

// ---------------------------------------------------------------------------
// Helper: set a token in state via the message handler
// ---------------------------------------------------------------------------
async function setToken(token) {
  mockMessenger.storage.local.set.mockResolvedValue({});
  await messageHandler({ type: "set_token", token });
}

// ---------------------------------------------------------------------------
// get_token
// ---------------------------------------------------------------------------
describe("get_token", () => {
  test("returns null token when none is stored", async () => {
    const result = await messageHandler({ type: "get_token" });
    expect(result).toEqual({ token: null });
  });

  test("returns 'SET' after a token is set", async () => {
    await setToken("xoxb-my-token");
    const result = await messageHandler({ type: "get_token" });
    expect(result).toEqual({ token: "SET" });
  });
});

// ---------------------------------------------------------------------------
// set_token
// ---------------------------------------------------------------------------
describe("set_token", () => {
  test("saves token to storage and starts polling", async () => {
    const result = await messageHandler({ type: "set_token", token: "xoxb-abc" });
    expect(result).toEqual({ success: true });
    expect(mockMessenger.storage.local.set).toHaveBeenCalledWith({ slackToken: "xoxb-abc" });
    expect(mockMessenger.alarms.create).toHaveBeenCalled();
  });

  test("clears token from storage and stops polling when token is null", async () => {
    await setToken("xoxb-abc"); // set first
    mockMessenger.alarms.clear.mockClear();

    const result = await messageHandler({ type: "set_token", token: null });
    expect(result).toEqual({ success: true });
    expect(mockMessenger.storage.local.remove).toHaveBeenCalledWith(["slackToken"]);
    expect(mockMessenger.alarms.clear).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// test_token
// ---------------------------------------------------------------------------
describe("test_token", () => {
  test("returns ok with team/user on a valid token", async () => {
    mockSlackApi({
      "auth.test": { ok: true, team: "My Workspace", user: "alice" },
    });

    const result = await messageHandler({ type: "test_token", token: "xoxb-valid" });
    expect(result).toEqual({ ok: true, team: "My Workspace", user: "alice" });
  });

  test("returns ok:false with error message on API failure", async () => {
    mockSlackApi({ "auth.test": { ok: false, error: "invalid_auth" } });

    const result = await messageHandler({ type: "test_token", token: "xoxb-bad" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid_auth");
  });

  test("does NOT persist the token after test_token", async () => {
    mockSlackApi({ "auth.test": { ok: true, team: "T", user: "u" } });
    await messageHandler({ type: "test_token", token: "xoxb-temp" });

    // token should still be null (not SET)
    const tokenResult = await messageHandler({ type: "get_token" });
    expect(tokenResult.token).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// get_channels
// ---------------------------------------------------------------------------
describe("get_channels", () => {
  test("returns channel list from conversations.list", async () => {
    await setToken("xoxb-tok");
    const channels = [
      { id: "C001", name: "general", is_member: true },
      { id: "C002", name: "random", is_member: true },
    ];
    mockSlackApi({ "conversations.list": { ok: true, channels, response_metadata: {} } });

    const result = await messageHandler({ type: "get_channels" });
    expect(result.channels).toEqual(channels);
  });

  test("returns error when no token", async () => {
    const result = await messageHandler({ type: "get_channels" });
    expect(result.error).toBeDefined();
  });

  test("paginates through multiple pages", async () => {
    await setToken("xoxb-tok");

    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              ok: true,
              channels: [{ id: "C001", name: "general" }],
              response_metadata: { next_cursor: "cursor-abc" },
            }),
        });
      }
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            ok: true,
            channels: [{ id: "C002", name: "random" }],
            response_metadata: { next_cursor: "" },
          }),
      });
    });

    const result = await messageHandler({ type: "get_channels" });
    expect(result.channels).toHaveLength(2);
    expect(callCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// get_unread
// ---------------------------------------------------------------------------
describe("get_unread", () => {
  test("returns empty array when no unread channels", async () => {
    const result = await messageHandler({ type: "get_unread" });
    expect(result).toEqual({ unreadChannels: [] });
  });
});

// ---------------------------------------------------------------------------
// get_messages
// ---------------------------------------------------------------------------
describe("get_messages", () => {
  test("returns messages from conversations.history", async () => {
    await setToken("xoxb-tok");
    const messages = [
      { ts: "1700000002.000", user: "U1", text: "hello" },
      { ts: "1700000001.000", user: "U2", text: "world" },
    ];
    mockSlackApi({
      "conversations.history": { ok: true, messages },
      "conversations.mark": { ok: true },
    });

    const result = await messageHandler({ type: "get_messages", channelId: "C001", limit: 50 });
    expect(result.messages).toEqual(messages);
  });

  test("marks channel as read when messages returned", async () => {
    await setToken("xoxb-tok");
    mockSlackApi({
      "conversations.history": {
        ok: true,
        messages: [{ ts: "1700000001.000", user: "U1", text: "hi" }],
      },
      "conversations.mark": { ok: true },
    });

    await messageHandler({ type: "get_messages", channelId: "C001" });

    const markCall = global.fetch.mock.calls.find(([url]) => url.includes("conversations.mark"));
    expect(markCall).toBeDefined();
  });

  test("returns empty array when no messages", async () => {
    await setToken("xoxb-tok");
    mockSlackApi({ "conversations.history": { ok: true, messages: [] } });

    const result = await messageHandler({ type: "get_messages", channelId: "C001" });
    expect(result.messages).toEqual([]);
  });

  test("returns error when no token", async () => {
    const result = await messageHandler({ type: "get_messages", channelId: "C001" });
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// send_message
// ---------------------------------------------------------------------------
describe("send_message", () => {
  test("calls chat.postMessage and returns message", async () => {
    await setToken("xoxb-tok");
    const sentMsg = { ts: "1700000099.000", text: "hello", user: "U1" };
    mockSlackApi({ "chat.postMessage": { ok: true, message: sentMsg } });

    const result = await messageHandler({
      type: "send_message",
      channelId: "C001",
      text: "hello",
    });
    expect(result.message).toEqual(sentMsg);
  });

  test("includes channel and text in request body", async () => {
    await setToken("xoxb-tok");
    mockSlackApi({ "chat.postMessage": { ok: true, message: {} } });

    await messageHandler({ type: "send_message", channelId: "C001", text: "test msg" });

    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.channel).toBe("C001");
    expect(body.text).toBe("test msg");
  });
});

// ---------------------------------------------------------------------------
// send_reply
// ---------------------------------------------------------------------------
describe("send_reply", () => {
  test("calls chat.postMessage with thread_ts and reply_broadcast", async () => {
    await setToken("xoxb-tok");
    mockSlackApi({ "chat.postMessage": { ok: true, message: { ts: "1700000099.000" } } });

    const result = await messageHandler({
      type: "send_reply",
      channelId: "C001",
      threadTs: "1700000001.000",
      text: "my reply",
    });

    expect(result.message).toBeDefined();
    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.thread_ts).toBe("1700000001.000");
    expect(body.reply_broadcast).toBe(true);
    expect(body.text).toBe("my reply");
  });
});

// ---------------------------------------------------------------------------
// get_user
// ---------------------------------------------------------------------------
describe("get_user", () => {
  test("returns user data from users.info", async () => {
    await setToken("xoxb-tok");
    const user = { id: "U001", real_name: "John Doe", profile: { display_name: "johndoe" } };
    mockSlackApi({ "users.info": { ok: true, user } });

    const result = await messageHandler({ type: "get_user", userId: "U001" });
    expect(result.user).toEqual(user);
  });
});

// ---------------------------------------------------------------------------
// Unknown message type
// ---------------------------------------------------------------------------
describe("unknown message type", () => {
  test("returns error for unrecognised type", async () => {
    const result = await messageHandler({ type: "totally_unknown" });
    expect(result.error).toMatch(/Unknown message type/);
  });
});

// ---------------------------------------------------------------------------
// Alarm / polling
// ---------------------------------------------------------------------------
describe("polling alarm", () => {
  test("alarm handler calls pollUnread when alarm name matches", async () => {
    await setToken("xoxb-tok");

    const channels = [
      { id: "C001", name: "general", is_member: true, unread_count: 3 },
      { id: "C002", name: "empty", is_member: true, unread_count: 0 },
    ];
    mockSlackApi({
      "conversations.list": { ok: true, channels, response_metadata: {} },
    });

    await alarmHandler({ name: "slack-poll" });

    const unread = await messageHandler({ type: "get_unread" });
    expect(unread.unreadChannels).toContain("C001");
    expect(unread.unreadChannels).not.toContain("C002");
  });

  test("alarm handler ignores alarms with different names", async () => {
    global.fetch = jest.fn();
    await alarmHandler({ name: "some-other-alarm" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Rate-limited mode
// ---------------------------------------------------------------------------
describe("rate-limited mode", () => {
  test("uses batch size of 200 when rate-limited mode is off", async () => {
    await setToken("xoxb-tok");
    mockSlackApi({ "conversations.list": { ok: true, channels: [], response_metadata: {} } });

    await messageHandler({ type: "get_channels" });

    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.limit).toBe(200);
  });

  test("uses batch size of 20 when rate-limited mode is enabled", async () => {
    await setToken("xoxb-tok");
    storageChangedHandler({ rateLimitedMode: { newValue: true } });
    mockSlackApi({ "conversations.list": { ok: true, channels: [], response_metadata: {} } });

    await messageHandler({ type: "get_channels" });

    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.limit).toBe(20);
  });

  test("disabling rate-limited mode via storage.onChanged restores batch size of 200", async () => {
    await setToken("xoxb-tok");
    storageChangedHandler({ rateLimitedMode: { newValue: true } });
    storageChangedHandler({ rateLimitedMode: { newValue: false } });
    mockSlackApi({ "conversations.list": { ok: true, channels: [], response_metadata: {} } });

    await messageHandler({ type: "get_channels" });

    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.limit).toBe(200);
  });

  test("applies delay between paginated requests when rate-limited mode is on", async () => {
    jest.useFakeTimers();
    try {
      await setToken("xoxb-tok");
      storageChangedHandler({ rateLimitedMode: { newValue: true } });

      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        callCount++;
        const cursor = callCount === 1 ? "cursor-abc" : "";
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              ok: true,
              channels: [{ id: `C00${callCount}`, name: `ch${callCount}` }],
              response_metadata: { next_cursor: cursor },
            }),
        });
      });

      const setTimeoutSpy = jest.spyOn(global, "setTimeout");
      const promise = messageHandler({ type: "get_channels" });
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
      expect(result.channels).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test("does not apply delay on the first page even in rate-limited mode", async () => {
    jest.useFakeTimers();
    try {
      await setToken("xoxb-tok");
      storageChangedHandler({ rateLimitedMode: { newValue: true } });
      mockSlackApi({ "conversations.list": { ok: true, channels: [], response_metadata: {} } });

      const setTimeoutSpy = jest.spyOn(global, "setTimeout");
      const promise = messageHandler({ type: "get_channels" });
      await jest.runAllTimersAsync();
      await promise;

      // No delay for the first (and only) page
      expect(setTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test("polling also uses rate-limited settings when mode is enabled", async () => {
    await setToken("xoxb-tok");
    storageChangedHandler({ rateLimitedMode: { newValue: true } });

    const channels = [{ id: "C001", is_member: true, unread_count: 1 }];
    mockSlackApi({ "conversations.list": { ok: true, channels, response_metadata: {} } });

    await alarmHandler({ name: "slack-poll" });

    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.limit).toBe(20);
  });
});
