"use strict";

/**
 * Unit tests for escHtml() and formatSlackText() — copied from space.js.
 * Uses jsdom's document (provided by jest-environment-jsdom).
 */

function escHtml(text) {
  const d = document.createElement("div");
  d.textContent = String(text);
  return d.innerHTML;
}

function formatSlackText(rawText, users) {
  let t = escHtml(rawText);

  t = t.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^a-z0-9])_([^_\n]+)_([^a-z0-9]|$)/gim, "$1<em>$2</em>$3");
  t = t.replace(/~([^~\n]+)~/g, "<del>$1</del>");
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  t = t.replace(/^&gt; (.+)/gm, "<blockquote>$1</blockquote>");
  t = t.replace(/\n/g, "<br />");

  t = t.replace(/&lt;@([A-Z0-9]+)(?:\|([^&]+))?&gt;/g, (_, uid, label) => {
    const u = users[uid];
    const name = label || (u && (u.profile?.display_name || u.real_name)) || uid;
    return `<span class="mention">@${escHtml(name)}</span>`;
  });

  t = t.replace(/&lt;#([A-Z0-9]+)\|([^&]+)&gt;/g, (_, _id, name) => {
    return `<strong>#${escHtml(name)}</strong>`;
  });

  t = t.replace(
    /&lt;(https?:\/\/[^|&>]+)(?:\|([^&>]+))?&gt;/g,
    (_, url, label) => {
      const display = label ? escHtml(label) : escHtml(url);
      return `<a href="${url}" target="_blank" rel="noreferrer noopener">${display}</a>`;
    }
  );

  return t;
}

describe("escHtml", () => {
  test("escapes < and >", () => {
    expect(escHtml("<script>")).toBe("&lt;script&gt;");
  });

  test("escapes & ampersand", () => {
    expect(escHtml("a & b")).toBe("a &amp; b");
  });

  test("double quotes in text content are not escaped (correct HTML behaviour)", () => {
    // Inside a text node, " does not need HTML escaping
    expect(escHtml('"hello"')).toBe('"hello"');
  });

  test("plain text passes through unchanged", () => {
    expect(escHtml("hello world")).toBe("hello world");
  });
});

describe("formatSlackText", () => {
  const emptyUsers = {};

  describe("bold", () => {
    test("wraps *text* in <strong>", () => {
      expect(formatSlackText("*bold*", emptyUsers)).toBe("<strong>bold</strong>");
    });

    test("handles bold inside sentence", () => {
      const result = formatSlackText("say *hello* now", emptyUsers);
      expect(result).toBe("say <strong>hello</strong> now");
    });
  });

  describe("italic", () => {
    test("wraps _text_ in <em>", () => {
      expect(formatSlackText("_italic_", emptyUsers)).toBe("<em>italic</em>");
    });

    test("does not italicise snake_case identifiers", () => {
      const result = formatSlackText("some_snake_case", emptyUsers);
      expect(result).not.toContain("<em>");
    });
  });

  describe("strikethrough", () => {
    test("wraps ~text~ in <del>", () => {
      expect(formatSlackText("~strike~", emptyUsers)).toBe("<del>strike</del>");
    });
  });

  describe("inline code", () => {
    test("wraps `text` in <code>", () => {
      expect(formatSlackText("`code`", emptyUsers)).toBe("<code>code</code>");
    });
  });

  describe("HTML escaping", () => {
    test("<script> tags are escaped and not executed", () => {
      const result = formatSlackText("<script>alert(1)</script>", emptyUsers);
      expect(result).not.toContain("<script>");
      expect(result).toContain("&lt;script&gt;");
    });

    test("& ampersand is escaped", () => {
      const result = formatSlackText("a & b", emptyUsers);
      expect(result).toContain("&amp;");
    });
  });

  describe("user mentions", () => {
    test("mention with label uses label text", () => {
      const result = formatSlackText("<@U123|John>", emptyUsers);
      expect(result).toBe('<span class="mention">@John</span>');
    });

    test("mention without label resolves from users cache", () => {
      const users = {
        U456: { profile: { display_name: "jane" }, real_name: "Jane Smith" },
      };
      const result = formatSlackText("<@U456>", users);
      expect(result).toBe('<span class="mention">@jane</span>');
    });

    test("mention without label or cache falls back to user ID", () => {
      const result = formatSlackText("<@UUNKNOWN>", emptyUsers);
      expect(result).toBe('<span class="mention">@UUNKNOWN</span>');
    });
  });

  describe("channel references", () => {
    test("renders channel reference as bold #name", () => {
      const result = formatSlackText("<#C123|general>", emptyUsers);
      expect(result).toBe("<strong>#general</strong>");
    });
  });

  describe("URLs", () => {
    test("URL with label shows label as link text", () => {
      const result = formatSlackText("<https://example.com|Click here>", emptyUsers);
      expect(result).toBe(
        '<a href="https://example.com" target="_blank" rel="noreferrer noopener">Click here</a>'
      );
    });

    test("URL without label shows URL as link text", () => {
      const result = formatSlackText("<https://example.com>", emptyUsers);
      expect(result).toBe(
        '<a href="https://example.com" target="_blank" rel="noreferrer noopener">https://example.com</a>'
      );
    });
  });

  describe("newlines", () => {
    test("converts newlines to <br />", () => {
      expect(formatSlackText("line1\nline2", emptyUsers)).toBe("line1<br />line2");
    });

    test("multiple newlines each become <br />", () => {
      const result = formatSlackText("a\nb\nc", emptyUsers);
      expect(result).toBe("a<br />b<br />c");
    });
  });

  describe("blockquote", () => {
    test("line starting with > becomes blockquote", () => {
      const result = formatSlackText("> quoted text", emptyUsers);
      expect(result).toBe("<blockquote>quoted text</blockquote>");
    });
  });
});
