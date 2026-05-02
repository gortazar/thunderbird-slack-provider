"use strict";

/**
 * Unit tests for nameInitials() — copied from space.js for isolated testing.
 */

function nameInitials(name) {
  const str = String(name || "?").trim();
  if (!str || str === "?") return "?";
  const words = str.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

describe("nameInitials", () => {
  test("two-word name returns first letters uppercased", () => {
    expect(nameInitials("John Doe")).toBe("JD");
  });

  test("single word returns first letter uppercased", () => {
    expect(nameInitials("Alice")).toBe("A");
  });

  test("three-word name uses first and last word initials", () => {
    expect(nameInitials("John Middle Doe")).toBe("JD");
  });

  test("empty string returns '?'", () => {
    expect(nameInitials("")).toBe("?");
  });

  test("literal '?' returns '?'", () => {
    expect(nameInitials("?")).toBe("?");
  });

  test("null returns '?'", () => {
    expect(nameInitials(null)).toBe("?");
  });

  test("undefined returns '?'", () => {
    expect(nameInitials(undefined)).toBe("?");
  });

  test("lowercase two-word name returns uppercased initials", () => {
    expect(nameInitials("alice bob")).toBe("AB");
  });

  test("extra whitespace is trimmed", () => {
    expect(nameInitials("  Jane   Smith  ")).toBe("JS");
  });
});
