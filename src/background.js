/**
 * background.js – Thunderbird Slack Provider
 *
 * Runs persistently in the extension background.  All Slack API calls are
 * funnelled through here so that the UI pages never need host permissions
 * themselves and the token is never exposed to page scripts.
 */

"use strict";

const SLACK_API = "https://slack.com/api";

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

// Serialise all watchedChannels storage mutations so concurrent messages from
// multiple space tabs cannot lose each other's writes.
let _watchedMutex = Promise.resolve();
function _withWatched(fn) {
  _watchedMutex = _watchedMutex.then(fn);
  return _watchedMutex;
}

let state = {
  token: null,
  slackSpaceId: null,
  unreadChannels: new Set(),
  pollingAlarmName: "slack-poll",
  rateLimitedMode: false,
  // chat: keyed by account id → { token, conversations: Map<channelId, convId> }
  chatAccounts: new Map(),
};

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------
messenger.runtime.onInstalled.addListener(async () => {
  await init();
});

messenger.runtime.onStartup.addListener(async () => {
  await init();
});

async function init() {
  const stored = await messenger.storage.local.get(["slackToken", "rateLimitedMode"]);
  if (stored.slackToken) {
    state.token = stored.slackToken;
    schedulePolling();
  }
  state.rateLimitedMode = !!stored.rateLimitedMode;
  await ensureSlackSpace();
}

// Keep rateLimitedMode in sync when the user changes it in the options page.
messenger.storage.onChanged.addListener((changes) => {
  if (changes.rateLimitedMode !== undefined) {
    state.rateLimitedMode = !!changes.rateLimitedMode.newValue;
  }
});

// Register chat protocol event listeners at module load so they are always
// active, independent of the init() lifecycle.
registerChatProtocol();

// ---------------------------------------------------------------------------
// Spaces API – add Slack to Thunderbird's spaces toolbar
// ---------------------------------------------------------------------------
async function ensureSlackSpace() {
  if (!messenger.spaces) {
    // messenger.spaces is available since Thunderbird 91 and stable in 128+
    console.warn("messenger.spaces is not available in this version of Thunderbird.");
    return;
  }
  try {
    const existing = await messenger.spaces.query({ name: "slack_provider" });
    if (existing.length === 0) {
      const space = await messenger.spaces.create("slack_provider", "space.html", {
        title: "Slack",
        defaultIcons: {
          "16": "icons/slack-16.svg",
          "32": "icons/slack-32.svg",
        },
      });
      state.slackSpaceId = space.id;
    } else {
      state.slackSpaceId = existing[0].id;
    }
  } catch (e) {
    console.error("Failed to create Slack space:", e);
  }
}

// ---------------------------------------------------------------------------
// Chat protocol – register Slack as a Thunderbird chat connection type
// ---------------------------------------------------------------------------

/**
 * Registers event listeners for the Thunderbird chat protocol.
 * The protocol itself is declared in manifest.json under "chat_protocols".
 * These listeners drive the account lifecycle: connecting, disconnecting, and
 * forwarding outgoing messages to the Slack API.
 */
function registerChatProtocol() {
  if (!messenger.chat) {
    // messenger.chat is available in Thunderbird 128+ when the "chat" permission
    // is granted.  Gracefully degrade on older builds.
    console.warn("messenger.chat is not available in this version of Thunderbird.");
    return;
  }

  messenger.chat.onAccountConnected.addListener(async (account) => {
    await handleChatAccountConnected(account);
  });

  messenger.chat.onAccountDisconnected.addListener((account) => {
    handleChatAccountDisconnected(account);
  });

  messenger.chat.onMessageSent.addListener(async (conversationId, text) => {
    await handleChatMessageSent(conversationId, text);
  });
}

/**
 * Called when the user connects a Slack chat account.
 * Reads the token from the account options (falling back to the globally
 * stored token), fetches the joined channels and opens a Thunderbird
 * conversation for each one.
 *
 * In rate-limited mode the full channel list is never fetched on connect.
 * Instead, only channels the user has already added to the watched list
 * (via the Slack space UI) are opened as conversations.
 */
async function handleChatAccountConnected(account) {
  // Prefer the per-account token stored in the account options; fall back to
  // the token previously saved via the options page.
  const accountToken = (account.options && account.options.token)
    ? account.options.token
    : state.token;

  if (!accountToken) {
    console.warn("Slack chat account connected but no API token is configured.");
    return;
  }

  // Initialise per-account state up-front so that onMessageSent can find it
  // even if the channel fetch is still in progress.
  const accountState = { token: accountToken, conversations: new Map() };
  state.chatAccounts.set(account.id, accountState);

  try {
    let joined;
    if (state.rateLimitedMode) {
      // In rate-limited mode avoid fetching all channels.  Use only the
      // channels the user has explicitly added via the watched list.
      const stored = await messenger.storage.local.get(["watchedChannels"]);
      joined = (stored.watchedChannels || []).filter((ch) => ch.is_member !== false);
      if (joined.length === 0) {
        console.info(
          "Rate-limited mode: no watched channels configured. " +
          "Use the Slack space to add channels via the workspace context menu."
        );
        // Notify any open space tab so the user sees the hint in the UI too
        try {
          await messenger.runtime.sendMessage({ type: "no_watched_channels" });
        } catch (_) {
          // No space tab open yet – the hint will appear when it's first opened
        }
        return;
      }
    } else {
      // Pass the account's token directly to avoid mutating global state and
      // introducing races with concurrent polling or UI requests.
      const channels = await fetchAllChannels(accountToken);
      joined = channels.filter((ch) => ch.is_member);
    }

    for (const ch of joined) {
      try {
        const conv = await messenger.chat.createConversation(account.id, ch.name);
        accountState.conversations.set(ch.id, conv.id);
      } catch (e) {
        console.error(`Failed to create conversation for #${ch.name}:`, e);
      }
    }
  } catch (e) {
    console.error("Failed to set up Slack chat account:", e);
    state.chatAccounts.delete(account.id);
  }
}

/**
 * Called when the user disconnects a Slack chat account.
 * Removes the account's entry from the in-memory map.
 */
function handleChatAccountDisconnected(account) {
  state.chatAccounts.delete(account.id);
}

/**
 * Called when the user sends a message from a Thunderbird chat conversation.
 * Finds the account that owns the conversation and posts the message using
 * that account's token.
 */
async function handleChatMessageSent(conversationId, text) {
  // Find which account owns this conversation and get its token.
  let slackChannelId = null;
  let accountToken = null;
  for (const [, accountState] of state.chatAccounts) {
    for (const [channelId, convId] of accountState.conversations) {
      if (convId === conversationId) {
        slackChannelId = channelId;
        accountToken = accountState.token;
        break;
      }
    }
    if (slackChannelId) { break; }
  }

  if (!slackChannelId) {
    console.warn("No Slack channel found for conversation", conversationId);
    return;
  }

  try {
    await slackPost("chat.postMessage", { channel: slackChannelId, text }, accountToken);
  } catch (e) {
    console.error("Failed to send Slack message from chat:", e);
  }
}

// ---------------------------------------------------------------------------
// Polling via alarms
// ---------------------------------------------------------------------------
function schedulePolling() {
  messenger.alarms.create(state.pollingAlarmName, {
    delayInMinutes: 0.5,
    periodInMinutes: 0.5,
  });
}

function stopPolling() {
  messenger.alarms.clear(state.pollingAlarmName);
}

messenger.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === state.pollingAlarmName) {
    await pollUnread();
  }
});

async function pollUnread() {
  if (!state.token) return;
  try {
    const channels = await fetchAllChannels();
    const unread = new Set();
    for (const ch of channels) {
      if (ch.is_member && ch.unread_count > 0) unread.add(ch.id);
    }
    state.unreadChannels = unread;

    // Notify open space tab(s)
    broadcastToTabs({
      type: "unread_updated",
      unreadChannels: Array.from(unread),
    });
  } catch (e) {
    console.error("Polling error:", e.message);
  }
}

// ---------------------------------------------------------------------------
// Slack API helpers
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RATE_LIMIT_DELAY_MS = 1000;

async function slackPost(method, params = {}, token = null) {
  const useToken = token || state.token;
  if (!useToken) throw new Error("No Slack token configured.");
  const resp = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${useToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(params),
  });
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || "Slack API error");
  return json;
}

// Paginate through all channels.
// In rate-limited mode each page uses a smaller batch size and a short delay
// is inserted between successive requests to stay within Slack's Tier-2 limit.
// An explicit token can be provided to avoid touching global state.
async function fetchAllChannels(token = null) {
  const channels = [];
  let cursor = undefined;
  let isFirstRequest = true;
  do {
    if (!isFirstRequest && state.rateLimitedMode) {
      await sleep(RATE_LIMIT_DELAY_MS);
    }
    isFirstRequest = false;
    const params = {
      types: "public_channel,private_channel",
      limit: state.rateLimitedMode ? 20 : 200,
      exclude_archived: true,
    };
    if (cursor) params.cursor = cursor;
    const data = await slackPost("conversations.list", params, token);
    channels.push(...(data.channels || []));
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return channels;
}

// ---------------------------------------------------------------------------
// Message handler (UI ↔ background)
// ---------------------------------------------------------------------------
messenger.runtime.onMessage.addListener(async (msg) => {
  try {
    switch (msg.type) {
      // ---- Workspace ---------------------------------------------------
      case "get_workspace_name": {
        const data = await slackPost("auth.test", {});
        return { name: data.team };
      }

      // ---- Watched channels (rate-limited mode) ------------------------
      case "get_watched_channels": {
        const stored = await messenger.storage.local.get(["watchedChannels"]);
        return { channels: stored.watchedChannels || [] };
      }

      case "add_watched_channel": {
        return await _withWatched(async () => {
          const stored = await messenger.storage.local.get(["watchedChannels"]);
          const existing = stored.watchedChannels || [];
          if (!existing.find((c) => c.id === msg.channel.id)) {
            const updated = [...existing, msg.channel];
            await messenger.storage.local.set({ watchedChannels: updated });
            return { success: true, channels: updated };
          }
          return { success: true, channels: existing };
        });
      }

      case "remove_watched_channel": {
        return await _withWatched(async () => {
          const stored = await messenger.storage.local.get(["watchedChannels"]);
          const updated = (stored.watchedChannels || []).filter((c) => c.id !== msg.channelId);
          await messenger.storage.local.set({ watchedChannels: updated });
          return { success: true, channels: updated };
        });
      }

      // ---- Channel lookup ----------------------------------------------
      case "get_channel_info": {
        const data = await slackPost("conversations.info", { channel: msg.channelId });
        return { channel: data.channel };
      }

      case "leave_channel": {
        await slackPost("conversations.leave", { channel: msg.channelId });
        return await _withWatched(async () => {
          const stored = await messenger.storage.local.get(["watchedChannels"]);
          const updated = (stored.watchedChannels || []).filter((c) => c.id !== msg.channelId);
          await messenger.storage.local.set({ watchedChannels: updated });
          return { success: true };
        });
      }

      // ---- Auth --------------------------------------------------------
      case "get_token":
        return { token: state.token ? "SET" : null };

      case "set_token": {
        if (msg.token) {
          state.token = msg.token;
          await messenger.storage.local.set({ slackToken: msg.token });
          schedulePolling();
        } else {
          state.token = null;
          await messenger.storage.local.remove(["slackToken"]);
          stopPolling();
        }
        return { success: true };
      }

      case "test_token": {
        const prev = state.token;
        state.token = msg.token;
        try {
          const data = await slackPost("auth.test", {});
          state.token = prev; // restore until explicitly saved
          return { ok: true, team: data.team, user: data.user };
        } catch (e) {
          state.token = prev;
          return { ok: false, error: e.message };
        }
      }

      // ---- Channels ----------------------------------------------------
      case "get_channels": {
        const channels = await fetchAllChannels();
        return { channels };
      }

      case "get_unread":
        return { unreadChannels: Array.from(state.unreadChannels) };

      // ---- Messages ----------------------------------------------------
      case "get_messages": {
        const data = await slackPost("conversations.history", {
          channel: msg.channelId,
          limit: msg.limit || 50,
        });
        // Mark as read
        if (data.messages && data.messages.length > 0) {
          try {
            await slackPost("conversations.mark", {
              channel: msg.channelId,
              ts: data.messages[0].ts,
            });
            state.unreadChannels.delete(msg.channelId);
          } catch (_) {
            // non-critical
          }
        }
        return { messages: data.messages || [] };
      }

      case "get_replies": {
        const data = await slackPost("conversations.replies", {
          channel: msg.channelId,
          ts: msg.threadTs,
          limit: 100,
        });
        return { messages: data.messages || [] };
      }

      // ---- Sending -----------------------------------------------------
      case "send_message": {
        const data = await slackPost("chat.postMessage", {
          channel: msg.channelId,
          text: msg.text,
        });
        return { message: data.message };
      }

      case "send_reply": {
        const data = await slackPost("chat.postMessage", {
          channel: msg.channelId,
          thread_ts: msg.threadTs,
          reply_broadcast: true,
          text: msg.text,
        });
        return { message: data.message };
      }

      // ---- Users -------------------------------------------------------
      case "get_user": {
        const data = await slackPost("users.info", { user: msg.userId });
        return { user: data.user };
      }

      default:
        return { error: `Unknown message type: ${msg.type}` };
    }
  } catch (e) {
    return { error: e.message };
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function broadcastToTabs(payload) {
  try {
    await messenger.runtime.sendMessage(payload);
  } catch (_) {
    // No listener – that's OK
  }
}
