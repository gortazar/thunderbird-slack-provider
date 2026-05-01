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
let state = {
  token: null,
  slackSpaceId: null,
  unreadChannels: new Set(),
  pollingAlarmName: "slack-poll",
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
  const stored = await messenger.storage.local.get(["slackToken"]);
  if (stored.slackToken) {
    state.token = stored.slackToken;
    schedulePolling();
  }
  await ensureSlackSpace();
}

// ---------------------------------------------------------------------------
// Spaces API – add Slack to Thunderbird's spaces toolbar
// ---------------------------------------------------------------------------
async function ensureSlackSpace() {
  if (!messenger.spaces) {
    // Spaces API requires Thunderbird 91+
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
    const data = await slackPost("conversations.list", {
      types: "public_channel,private_channel",
      limit: 200,
      exclude_archived: true,
    });
    const unread = new Set();
    for (const ch of data.channels || []) {
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
async function slackPost(method, params = {}) {
  if (!state.token) throw new Error("No Slack token configured.");
  const resp = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${state.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(params),
  });
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || "Slack API error");
  return json;
}

// Paginate through all channels
async function fetchAllChannels() {
  const channels = [];
  let cursor = undefined;
  do {
    const params = {
      types: "public_channel,private_channel",
      limit: 200,
      exclude_archived: true,
    };
    if (cursor) params.cursor = cursor;
    const data = await slackPost("conversations.list", params);
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
