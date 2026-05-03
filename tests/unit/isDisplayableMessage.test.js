"use strict";

/**
 * Unit tests for isDisplayableMessage() — copied from space.js for isolated testing.
 */

function isDisplayableMessage(msg) {
  const skipTypes = ["channel_join", "channel_leave", "channel_topic", "channel_purpose"];
  return !skipTypes.includes(msg.subtype);
}

describe("isDisplayableMessage", () => {
  test("regular message with no subtype is displayable", () => {
    expect(isDisplayableMessage({ type: "message", text: "hello" })).toBe(true);
  });

  test("channel_join subtype is hidden", () => {
    expect(isDisplayableMessage({ subtype: "channel_join" })).toBe(false);
  });

  test("channel_leave subtype is hidden", () => {
    expect(isDisplayableMessage({ subtype: "channel_leave" })).toBe(false);
  });

  test("channel_topic subtype is hidden", () => {
    expect(isDisplayableMessage({ subtype: "channel_topic" })).toBe(false);
  });

  test("channel_purpose subtype is hidden", () => {
    expect(isDisplayableMessage({ subtype: "channel_purpose" })).toBe(false);
  });

  test("bot_message subtype is displayable (not a skip type)", () => {
    expect(isDisplayableMessage({ subtype: "bot_message" })).toBe(true);
  });

  test("undefined subtype is displayable", () => {
    expect(isDisplayableMessage({ subtype: undefined })).toBe(true);
  });
});
