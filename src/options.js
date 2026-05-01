/**
 * options.js – Thunderbird Slack Provider settings page
 */

"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  // Load current token (we only show that one is set, not the value itself)
  const stored = await messenger.storage.local.get(["slackToken"]);
  if (stored.slackToken) {
    document.getElementById("slack-token").value = stored.slackToken;
    setIndicator("ok", "Token loaded from storage.");
  }

  document.getElementById("btn-save").addEventListener("click", saveToken);
  document.getElementById("btn-test").addEventListener("click", testConnection);
  document.getElementById("btn-clear").addEventListener("click", clearToken);
});

async function saveToken() {
  const token = document.getElementById("slack-token").value.trim();
  if (!token) {
    showStatus("Please enter a token.", "error");
    return;
  }

  const res = await messenger.runtime.sendMessage({ type: "set_token", token });
  if (res.success) {
    showStatus("Token saved successfully!", "success");
  } else {
    showStatus("Failed to save token.", "error");
  }
}

async function testConnection() {
  const token = document.getElementById("slack-token").value.trim();
  if (!token) {
    showStatus("Enter a token first.", "error");
    return;
  }

  showStatus("Testing connection…", "info");
  const res = await messenger.runtime.sendMessage({ type: "test_token", token });

  if (res.ok) {
    setIndicator("ok", `Connected as ${res.user} to ${res.team}`);
    showStatus(`✓ Connected to workspace "${res.team}" as "${res.user}".`, "success");
  } else {
    setIndicator("fail", "Connection failed");
    showStatus(`Connection failed: ${res.error}`, "error");
  }
}

async function clearToken() {
  await messenger.runtime.sendMessage({ type: "set_token", token: null });
  await messenger.storage.local.remove(["slackToken"]);
  document.getElementById("slack-token").value = "";
  setIndicator("unknown", "Unknown — use "Test Connection" to verify.");
  showStatus("Token cleared.", "info");
}

function showStatus(msg, type) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  el.className = `status-msg ${type}`;
  el.classList.remove("hidden");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add("hidden"), 6000);
}

function setIndicator(state, text) {
  const ind = document.getElementById("indicator");
  const label = document.getElementById("status-text");

  ind.className = `indicator indicator-${state}`;
  label.textContent = text;
}
