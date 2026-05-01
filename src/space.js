/**
 * space.js – Thunderbird Slack Provider UI
 *
 * Drives the three-pane Slack interface embedded in a Thunderbird Space tab.
 */

"use strict";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentChannel = null;
const userCache = {};

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  const res = await bg({ type: "get_token" });
  if (res.token) {
    showMain();
    await loadChannels();
  } else {
    showAuth();
  }

  // Wire static buttons
  document.getElementById("btn-open-settings").addEventListener("click", () => {
    messenger.runtime.openOptionsPage();
  });

  document.getElementById("btn-refresh-channels").addEventListener("click", () => {
    loadChannels();
  });

  document.getElementById("btn-send").addEventListener("click", sendChannelMessage);

  document.getElementById("message-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChannelMessage();
    }
  });
});

// Listen for unread updates pushed from the background script
messenger.runtime.onMessage.addListener((msg) => {
  if (msg.type === "unread_updated") {
    refreshUnreadBadges(new Set(msg.unreadChannels));
  }
});

// ---------------------------------------------------------------------------
// Panel visibility
// ---------------------------------------------------------------------------
function showAuth() {
  document.getElementById("auth-panel").classList.remove("hidden");
  document.getElementById("main-panel").classList.add("hidden");
}

function showMain() {
  document.getElementById("auth-panel").classList.add("hidden");
  document.getElementById("main-panel").classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Channel list
// ---------------------------------------------------------------------------
async function loadChannels() {
  const listEl = document.getElementById("channel-list");
  listEl.innerHTML = '<div class="status-msg">Loading channels…</div>';

  const [chanRes, unreadRes] = await Promise.all([
    bg({ type: "get_channels" }),
    bg({ type: "get_unread" }),
  ]);

  if (chanRes.error) {
    listEl.innerHTML = `<div class="error-msg">Error: ${escHtml(chanRes.error)}</div>`;
    return;
  }

  const channels = (chanRes.channels || []).filter((c) => c.is_member);
  const unread = new Set(unreadRes.unreadChannels || []);

  renderChannelList(channels, unread);
}

function renderChannelList(channels, unreadSet) {
  const listEl = document.getElementById("channel-list");
  listEl.innerHTML = "";

  if (channels.length === 0) {
    listEl.innerHTML = '<div class="status-msg">No channels found.</div>';
    return;
  }

  // Sort: unread first, then alphabetical
  const sorted = [...channels].sort((a, b) => {
    const au = unreadSet.has(a.id) ? 0 : 1;
    const bu = unreadSet.has(b.id) ? 0 : 1;
    if (au !== bu) return au - bu;
    return a.name.localeCompare(b.name);
  });

  for (const ch of sorted) {
    const item = document.createElement("div");
    item.className = "channel-item";
    item.setAttribute("role", "option");
    item.dataset.channelId = ch.id;

    if (unreadSet.has(ch.id)) item.classList.add("unread");
    if (currentChannel && currentChannel.id === ch.id) item.classList.add("active");

    const prefix = ch.is_private ? "🔒" : "#";
    item.textContent = `${prefix} ${ch.name}`;

    item.addEventListener("click", () => selectChannel(ch));
    listEl.appendChild(item);
  }
}

function refreshUnreadBadges(unreadSet) {
  document.querySelectorAll(".channel-item").forEach((el) => {
    const id = el.dataset.channelId;
    if (unreadSet.has(id)) {
      el.classList.add("unread");
    } else {
      el.classList.remove("unread");
    }
  });
}

// ---------------------------------------------------------------------------
// Message list
// ---------------------------------------------------------------------------
async function selectChannel(channel) {
  currentChannel = channel;

  // Update header
  document.getElementById("channel-label").textContent = `# ${channel.name}`;
  document.getElementById("message-input").placeholder =
    `Message #${channel.name} — press Enter to send, Shift+Enter for new line`;

  // Mark active in sidebar and clear unread badge
  document.querySelectorAll(".channel-item").forEach((el) => {
    el.classList.remove("active");
    if (el.dataset.channelId === channel.id) {
      el.classList.add("active");
      el.classList.remove("unread");
    }
  });

  await loadMessages(channel.id);
}

async function loadMessages(channelId) {
  const listEl = document.getElementById("messages-list");
  listEl.innerHTML = '<div class="status-msg">Loading messages…</div>';

  const res = await bg({ type: "get_messages", channelId, limit: 50 });
  if (res.error) {
    listEl.innerHTML = `<div class="error-msg">Error: ${escHtml(res.error)}</div>`;
    return;
  }

  const messages = (res.messages || []).filter(isDisplayableMessage).reverse();

  if (messages.length === 0) {
    listEl.innerHTML = '<div class="status-msg">No messages in this channel yet.</div>';
    return;
  }

  listEl.innerHTML = "";
  for (const msg of messages) {
    const el = await buildMessageElement(msg);
    listEl.appendChild(el);
  }

  scrollToBottom();
}

function isDisplayableMessage(msg) {
  // Skip join/leave and other system subtypes
  const skipTypes = ["channel_join", "channel_leave", "channel_topic", "channel_purpose"];
  return !skipTypes.includes(msg.subtype);
}

// ---------------------------------------------------------------------------
// Message element builder
// ---------------------------------------------------------------------------
async function buildMessageElement(msg) {
  const wrap = document.createElement("div");
  wrap.className = "message";
  wrap.dataset.ts = msg.ts;

  // Resolve user/bot name
  let username = "Unknown";
  let avatarHtml = "";

  if (msg.user) {
    const user = await resolveUser(msg.user);
    username = user.profile?.display_name || user.real_name || user.name || msg.user;
    const avatarUrl = user.profile?.image_48 || "";
    avatarHtml = avatarUrl
      ? `<img src="${avatarUrl}" alt="${escHtml(username)}" />`
      : avatarPlaceholder(username);
  } else if (msg.bot_profile) {
    username = msg.bot_profile.name || "Bot";
    avatarHtml = avatarPlaceholder(username);
  } else if (msg.username) {
    username = msg.username;
    avatarHtml = avatarPlaceholder(username);
  } else {
    avatarHtml = avatarPlaceholder("?");
  }

  // Timestamp
  const ts = parseFloat(msg.ts);
  const d = new Date(ts * 1000);
  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const fullDateTime = d.toLocaleString();

  // Reply info
  const replyCount = msg.reply_count || 0;
  const replyLabel = replyCount === 1 ? "1 reply" : `${replyCount} replies`;

  // Safe ID for DOM
  const safeTs = safeDomId(msg.ts);

  wrap.innerHTML = `
    <div class="message-avatar">${avatarHtml}</div>
    <div class="message-content">
      <div class="message-header">
        <span class="message-author">${escHtml(username)}</span>
        <span class="message-time" title="${escHtml(fullDateTime)}">${timeStr}</span>
      </div>
      <div class="message-text">${formatSlackText(msg.text || "", userCache)}</div>
      <div class="message-actions">
        <button class="btn btn-ghost reply-btn" data-ts="${msg.ts}">
          💬 Reply${replyCount > 0 ? ` &nbsp;·&nbsp; <span class="reply-count">${replyLabel}</span>` : ""}
        </button>
      </div>
      <div class="reply-form hidden" id="rf-${safeTs}">
        <textarea
          class="reply-textarea"
          placeholder="Reply to thread (also sent to channel)…"
          rows="2"
          aria-label="Reply"
        ></textarea>
        <div class="reply-form-actions">
          <button class="btn btn-secondary cancel-reply-btn">Cancel</button>
          <button class="btn btn-primary send-reply-btn">Send Reply</button>
        </div>
      </div>
    </div>
  `;

  // Event: toggle reply form
  wrap.querySelector(".reply-btn").addEventListener("click", () => {
    toggleReplyForm(msg.ts);
  });

  // Event: send reply
  const sendFn = () => submitReply(msg.ts, wrap);
  wrap.querySelector(".send-reply-btn").addEventListener("click", sendFn);
  wrap.querySelector(".reply-textarea").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendFn();
    }
  });

  // Event: cancel reply
  wrap.querySelector(".cancel-reply-btn").addEventListener("click", () => {
    document.getElementById(`rf-${safeTs}`).classList.add("hidden");
  });

  return wrap;
}

function avatarPlaceholder(name) {
  const letter = String(name || "?")[0].toUpperCase();
  return `<div class="avatar-placeholder">${escHtml(letter)}</div>`;
}

// ---------------------------------------------------------------------------
// Reply handling
// ---------------------------------------------------------------------------
function toggleReplyForm(ts) {
  const form = document.getElementById(`rf-${safeDomId(ts)}`);
  if (!form) return;
  form.classList.toggle("hidden");
  if (!form.classList.contains("hidden")) {
    form.querySelector(".reply-textarea")?.focus();
  }
}

async function submitReply(threadTs, msgWrap) {
  if (!currentChannel) return;

  const form = msgWrap.querySelector(".reply-form");
  const textarea = form.querySelector(".reply-textarea");
  const text = textarea.value.trim();
  if (!text) return;

  const btn = form.querySelector(".send-reply-btn");
  btn.disabled = true;
  btn.textContent = "Sending…";

  const res = await bg({
    type: "send_reply",
    channelId: currentChannel.id,
    threadTs,
    text,
  });

  btn.disabled = false;
  btn.textContent = "Send Reply";

  if (res.error) {
    alert(`Failed to send reply: ${res.error}`);
    return;
  }

  textarea.value = "";
  form.classList.add("hidden");
  await loadMessages(currentChannel.id);
}

// ---------------------------------------------------------------------------
// Sending a new channel message
// ---------------------------------------------------------------------------
async function sendChannelMessage() {
  if (!currentChannel) return;

  const input = document.getElementById("message-input");
  const text = input.value.trim();
  if (!text) return;

  const btn = document.getElementById("btn-send");
  btn.disabled = true;

  const res = await bg({
    type: "send_message",
    channelId: currentChannel.id,
    text,
  });

  btn.disabled = false;

  if (res.error) {
    alert(`Failed to send message: ${res.error}`);
    return;
  }

  input.value = "";
  await loadMessages(currentChannel.id);
}

// ---------------------------------------------------------------------------
// User cache
// ---------------------------------------------------------------------------
async function resolveUser(userId) {
  if (userCache[userId]) return userCache[userId];
  const res = await bg({ type: "get_user", userId });
  if (res.user) {
    userCache[userId] = res.user;
    return res.user;
  }
  return { name: userId };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function bg(msg) {
  return messenger.runtime.sendMessage(msg);
}

function scrollToBottom() {
  const container = document.getElementById("messages-container");
  container.scrollTop = container.scrollHeight;
}

function safeDomId(ts) {
  return ts.replace(".", "-");
}

function escHtml(text) {
  const d = document.createElement("div");
  d.textContent = String(text);
  return d.innerHTML;
}

/**
 * Convert Slack mrkdwn to safe HTML.
 * Works on already-escaped HTML (call after escHtml on the raw text).
 */
function formatSlackText(rawText, users) {
  // First escape HTML entities
  let t = escHtml(rawText);

  // Bold   *text*
  t = t.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");
  // Italic _text_  (avoid matching snake_case by requiring a non-word boundary)
  t = t.replace(/(^|[^a-z0-9])_([^_\n]+)_([^a-z0-9]|$)/gim, "$1<em>$2</em>$3");
  // Strikethrough ~text~
  t = t.replace(/~([^~\n]+)~/g, "<del>$1</del>");
  // Inline code `text`
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // Blockquote >&gt;
  t = t.replace(/^&gt; (.+)/gm, "<blockquote>$1</blockquote>");
  // Newlines
  t = t.replace(/\n/g, "<br />");

  // Slack user mentions &lt;@UXXX&gt;
  t = t.replace(/&lt;@([A-Z0-9]+)(?:\|([^&]+))?&gt;/g, (_, uid, label) => {
    const u = users[uid];
    const name = label || (u && (u.profile?.display_name || u.real_name)) || uid;
    return `<span class="mention">@${escHtml(name)}</span>`;
  });

  // Channel references &lt;#CXXX|name&gt;
  t = t.replace(/&lt;#([A-Z0-9]+)\|([^&]+)&gt;/g, (_, _id, name) => {
    return `<strong>#${escHtml(name)}</strong>`;
  });

  // URLs &lt;https://…|label&gt; or &lt;https://…&gt;
  t = t.replace(
    /&lt;(https?:\/\/[^|&>]+)(?:\|([^&>]+))?&gt;/g,
    (_, url, label) => {
      const display = label ? escHtml(label) : escHtml(url);
      return `<a href="${url}" target="_blank" rel="noreferrer noopener">${display}</a>`;
    }
  );

  return t;
}
