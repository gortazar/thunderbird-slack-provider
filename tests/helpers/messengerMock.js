"use strict";

/**
 * Creates a mock for the `messenger` global used by background.js, space.js,
 * and options.js. Captures registered listeners so tests can invoke them
 * directly.
 */
function createMessengerMock() {
  const listeners = {
    onInstalled: [],
    onStartup: [],
    onMessage: [],
    onAlarm: [],
    onStorageChanged: [],
    onChatAccountConnected: [],
    onChatAccountDisconnected: [],
    onChatMessageSent: [],
  };

  const mock = {
    runtime: {
      onInstalled: {
        addListener: jest.fn((fn) => listeners.onInstalled.push(fn)),
      },
      onStartup: {
        addListener: jest.fn((fn) => listeners.onStartup.push(fn)),
      },
      onMessage: {
        addListener: jest.fn((fn) => listeners.onMessage.push(fn)),
      },
      sendMessage: jest.fn().mockResolvedValue(undefined),
      openOptionsPage: jest.fn(),
    },
    storage: {
      local: {
        get: jest.fn().mockResolvedValue({}),
        set: jest.fn().mockResolvedValue({}),
        remove: jest.fn().mockResolvedValue({}),
      },
      onChanged: {
        addListener: jest.fn((fn) => listeners.onStorageChanged.push(fn)),
      },
    },
    alarms: {
      create: jest.fn(),
      clear: jest.fn(),
      onAlarm: {
        addListener: jest.fn((fn) => listeners.onAlarm.push(fn)),
      },
    },
    spaces: {
      query: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'space-1' }),
    },
    chat: {
      onAccountConnected: {
        addListener: jest.fn((fn) => listeners.onChatAccountConnected.push(fn)),
      },
      onAccountDisconnected: {
        addListener: jest.fn((fn) => listeners.onChatAccountDisconnected.push(fn)),
      },
      onMessageSent: {
        addListener: jest.fn((fn) => listeners.onChatMessageSent.push(fn)),
      },
      createConversation: jest.fn().mockResolvedValue({ id: 'conv-1' }),
    },

    // Expose captured listeners for test use
    _listeners: listeners,
  };

  return mock;
}

module.exports = { createMessengerMock };
