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
let chatAccountConnectedHandler;
let chatAccountDisconnectedHandler;
let chatMessageSentHandler;
let mockMessenger;

function createMockMessenger() {
  messageHandler = null;
  alarmHandler = null;
  storageChangedHandler = null;
  chatAccountConnectedHandler = null;
  chatAccountDisconnectedHandler = null;
  chatMessageSentHandler = null;

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
    chat: {
      onAccountConnected: {
        addListener: jest.fn((fn) => {
          chatAccountConnectedHandler = fn;
        }),
      },
      onAccountDisconnected: {
        addListener: jest.fn((fn) => {
          chatAccountDisconnectedHandler = fn;
        }),
      },
      onMessageSent: {
        addListener: jest.fn((fn) => {
          chatMessageSentHandler = fn;
        }),
      },
      createConversation: jest.fn().mockResolvedValue({ id: "conv-1" }),
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

// ---------------------------------------------------------------------------
// Chat protocol
// ---------------------------------------------------------------------------
describe("chat protocol registration", () => {
  test("registers all three chat event listeners on init", () => {
    expect(mockMessenger.chat.onAccountConnected.addListener).toHaveBeenCalledTimes(1);
    expect(mockMessenger.chat.onAccountDisconnected.addListener).toHaveBeenCalledTimes(1);
    expect(mockMessenger.chat.onMessageSent.addListener).toHaveBeenCalledTimes(1);
  });

  test("skips chat registration when messenger.chat is absent", () => {
    delete mockMessenger.chat;
    // Re-loading background.js with no messenger.chat should not throw
    expect(() => loadBackground()).not.toThrow();
  });
});

describe("chat account connected", () => {
  test("creates a conversation for each joined channel", async () => {
    await setToken("xoxb-tok");

    const channels = [
      { id: "C001", name: "general", is_member: true },
      { id: "C002", name: "random", is_member: true },
      { id: "C003", name: "not-joined", is_member: false },
    ];
    mockSlackApi({ "conversations.list": { ok: true, channels, response_metadata: {} } });

    await chatAccountConnectedHandler({ id: "acc-1", options: {} });

    expect(mockMessenger.chat.createConversation).toHaveBeenCalledTimes(2);
    expect(mockMessenger.chat.createConversation).toHaveBeenCalledWith("acc-1", "general");
    expect(mockMessenger.chat.createConversation).toHaveBeenCalledWith("acc-1", "random");
  });

  test("uses per-account token when provided in account options", async () => {
    const channels = [{ id: "C001", name: "general", is_member: true }];
    mockSlackApi({ "conversations.list": { ok: true, channels, response_metadata: {} } });

    await chatAccountConnectedHandler({ id: "acc-2", options: { token: "xoxb-account-token" } });

    // The API call should have been made (token was available via account options)
    expect(mockMessenger.chat.createConversation).toHaveBeenCalledWith("acc-2", "general");
  });

  test("does nothing when no token is available", async () => {
    await chatAccountConnectedHandler({ id: "acc-3", options: {} });

    expect(mockMessenger.chat.createConversation).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("chat account disconnected", () => {
  test("clears chat state when the active account disconnects", async () => {
    await setToken("xoxb-tok");
    const channels = [{ id: "C001", name: "general", is_member: true }];
    mockSlackApi({ "conversations.list": { ok: true, channels, response_metadata: {} } });

    await chatAccountConnectedHandler({ id: "acc-1", options: {} });
    expect(mockMessenger.chat.createConversation).toHaveBeenCalledTimes(1);

    chatAccountDisconnectedHandler({ id: "acc-1" });

    // After disconnect, sending a message should be a no-op (no channel mapping)
    global.fetch = jest.fn();
    await chatMessageSentHandler("conv-1", "hello");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("ignores disconnect events for a different account id", async () => {
    await setToken("xoxb-tok");
    const channels = [{ id: "C001", name: "general", is_member: true }];
    mockSlackApi({ "conversations.list": { ok: true, channels, response_metadata: {} } });

    await chatAccountConnectedHandler({ id: "acc-1", options: {} });
    mockMessenger.chat.createConversation.mockClear();

    // Disconnect a different account — should not clear the active account state
    chatAccountDisconnectedHandler({ id: "acc-999" });

    // The conversation map should still be intact: posting should route to Slack
    mockSlackApi({ "chat.postMessage": { ok: true, message: {} } });
    await chatMessageSentHandler("conv-1", "still works");
    const calls = global.fetch.mock.calls.filter(([url]) => url.includes("chat.postMessage"));
    expect(calls).toHaveLength(1);
  });
});

describe("chat message sent", () => {
  test("posts to the correct Slack channel when a message is sent", async () => {
    await setToken("xoxb-tok");

    let convIdCounter = 0;
    mockMessenger.chat.createConversation.mockImplementation(() => {
      convIdCounter++;
      return Promise.resolve({ id: `conv-${convIdCounter}` });
    });

    const channels = [
      { id: "C001", name: "general", is_member: true },
      { id: "C002", name: "random", is_member: true },
    ];
    mockSlackApi({ "conversations.list": { ok: true, channels, response_metadata: {} } });
    await chatAccountConnectedHandler({ id: "acc-1", options: {} });

    mockSlackApi({ "chat.postMessage": { ok: true, message: {} } });
    await chatMessageSentHandler("conv-2", "hello random");

    const postCall = global.fetch.mock.calls.find(([url]) => url.includes("chat.postMessage"));
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall[1].body);
    expect(body.channel).toBe("C002");
    expect(body.text).toBe("hello random");
  });

  test("uses per-account token (not global) when sending a message", async () => {
    // No global token – only the account-level token should be used.
    const channels = [{ id: "C001", name: "general", is_member: true }];
    mockSlackApi({ "conversations.list": { ok: true, channels, response_metadata: {} } });

    await chatAccountConnectedHandler({ id: "acc-2", options: { token: "xoxb-account-only" } });

    mockSlackApi({ "chat.postMessage": { ok: true, message: {} } });
    await chatMessageSentHandler("conv-1", "hello from account token");

    const postCall = global.fetch.mock.calls.find(([url]) => url.includes("chat.postMessage"));
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall[1].body);
    expect(body.channel).toBe("C001");
    // Verify the per-account token was used, not any global token.
    expect(postCall[1].headers.Authorization).toBe("Bearer xoxb-account-only");
  });

  test("does nothing when no matching conversation is found", async () => {
    await setToken("xoxb-tok");
    global.fetch = jest.fn();
    await chatMessageSentHandler("conv-unknown", "hello");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("does nothing when no token is set", async () => {
    global.fetch = jest.fn();
    await chatMessageSentHandler("conv-1", "hello");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// get_workspace_name
// ---------------------------------------------------------------------------
describe("get_workspace_name", () => {
  test("returns team name from auth.test", async () => {
    await setToken("xoxb-tok");
    mockSlackApi({ "auth.test": { ok: true, team: "ACME Corp", user: "alice" } });

    const result = await messageHandler({ type: "get_workspace_name" });
    expect(result).toEqual({ name: "ACME Corp" });
  });

  test("returns error when no token is set", async () => {
    const result = await messageHandler({ type: "get_workspace_name" });
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// get_watched_channels / add_watched_channel / remove_watched_channel
// ---------------------------------------------------------------------------
describe("watched channels", () => {
  test("get_watched_channels returns empty array when nothing is stored", async () => {
    const result = await messageHandler({ type: "get_watched_channels" });
    expect(result).toEqual({ channels: [] });
  });

  test("add_watched_channel persists a channel and returns updated list", async () => {
    const ch = { id: "C001", name: "general", is_private: false, is_member: true };

    // Simulate storage: first get returns empty, set is a no-op
    mockMessenger.storage.local.get.mockResolvedValue({ watchedChannels: [] });
    mockMessenger.storage.local.set.mockResolvedValue({});

    const result = await messageHandler({ type: "add_watched_channel", channel: ch });
    expect(result.success).toBe(true);
    expect(result.channels).toContainEqual(ch);
    expect(mockMessenger.storage.local.set).toHaveBeenCalledWith({
      watchedChannels: [ch],
    });
  });

  test("add_watched_channel does not add duplicates", async () => {
    const ch = { id: "C001", name: "general", is_private: false, is_member: true };
    mockMessenger.storage.local.get.mockResolvedValue({ watchedChannels: [ch] });
    mockMessenger.storage.local.set.mockResolvedValue({});

    const result = await messageHandler({ type: "add_watched_channel", channel: ch });
    expect(result.channels).toHaveLength(1);
    // storage.set should NOT be called since nothing changed
    expect(mockMessenger.storage.local.set).not.toHaveBeenCalled();
  });

  test("remove_watched_channel removes the channel by id", async () => {
    const channels = [
      { id: "C001", name: "general" },
      { id: "C002", name: "random" },
    ];
    mockMessenger.storage.local.get.mockResolvedValue({ watchedChannels: channels });
    mockMessenger.storage.local.set.mockResolvedValue({});

    const result = await messageHandler({ type: "remove_watched_channel", channelId: "C001" });
    expect(result.success).toBe(true);
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].id).toBe("C002");
    expect(mockMessenger.storage.local.set).toHaveBeenCalledWith({
      watchedChannels: [{ id: "C002", name: "random" }],
    });
  });
});

// ---------------------------------------------------------------------------
// get_channel_info
// ---------------------------------------------------------------------------
describe("get_channel_info", () => {
  test("returns channel data from conversations.info", async () => {
    await setToken("xoxb-tok");
    const channel = { id: "C001", name: "general", is_member: true, is_private: false };
    mockSlackApi({ "conversations.info": { ok: true, channel } });

    const result = await messageHandler({ type: "get_channel_info", channelId: "C001" });
    expect(result.channel).toEqual(channel);
  });

  test("returns error when channel not found", async () => {
    await setToken("xoxb-tok");
    mockSlackApi({ "conversations.info": { ok: false, error: "channel_not_found" } });

    const result = await messageHandler({ type: "get_channel_info", channelId: "CBAD" });
    expect(result.error).toContain("channel_not_found");
  });
});

// ---------------------------------------------------------------------------
// leave_channel
// ---------------------------------------------------------------------------
describe("leave_channel", () => {
  test("calls conversations.leave and removes channel from watched list", async () => {
    await setToken("xoxb-tok");
    mockSlackApi({ "conversations.leave": { ok: true } });
    mockMessenger.storage.local.get.mockResolvedValue({
      watchedChannels: [{ id: "C001", name: "general" }],
    });
    mockMessenger.storage.local.set.mockResolvedValue({});

    const result = await messageHandler({ type: "leave_channel", channelId: "C001" });
    expect(result.success).toBe(true);

    const leaveCall = global.fetch.mock.calls.find(([url]) =>
      url.includes("conversations.leave")
    );
    expect(leaveCall).toBeDefined();

    expect(mockMessenger.storage.local.set).toHaveBeenCalledWith({ watchedChannels: [] });
  });

  test("returns error when leave fails", async () => {
    await setToken("xoxb-tok");
    mockSlackApi({ "conversations.leave": { ok: false, error: "cant_leave_general" } });

    const result = await messageHandler({ type: "leave_channel", channelId: "C001" });
    expect(result.error).toContain("cant_leave_general");
  });
});

// ---------------------------------------------------------------------------
// chat account connected – rate-limited mode
// ---------------------------------------------------------------------------
describe("chat account connected – rate-limited mode", () => {
  test("uses watched channels instead of fetching all when rateLimitedMode is enabled", async () => {
    await setToken("xoxb-tok");
    storageChangedHandler({ rateLimitedMode: { newValue: true } });

    const watchedChannels = [
      { id: "C001", name: "general", is_member: true },
    ];
    mockMessenger.storage.local.get.mockResolvedValue({ watchedChannels });

    await chatAccountConnectedHandler({ id: "acc-1", options: {} });

    // Should NOT have called conversations.list
    const listCall = global.fetch.mock.calls.find(([url]) =>
      url.includes("conversations.list")
    );
    expect(listCall).toBeUndefined();

    // Should have created a conversation for the watched channel
    expect(mockMessenger.chat.createConversation).toHaveBeenCalledWith("acc-1", "general");
  });

  test("does nothing when rateLimitedMode is enabled and no watched channels are stored", async () => {
    await setToken("xoxb-tok");
    storageChangedHandler({ rateLimitedMode: { newValue: true } });
    mockMessenger.storage.local.get.mockResolvedValue({ watchedChannels: [] });

    await chatAccountConnectedHandler({ id: "acc-1", options: {} });

    expect(mockMessenger.chat.createConversation).not.toHaveBeenCalled();
    const listCall = global.fetch.mock.calls.find(([url]) =>
      url.includes("conversations.list")
    );
    expect(listCall).toBeUndefined();
    // Should notify the space UI so the hint is visible to the user
    expect(mockMessenger.runtime.sendMessage).toHaveBeenCalledWith({ type: "no_watched_channels" });
  });
});
