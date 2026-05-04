"use strict";

const security = require("eslint-plugin-security");

module.exports = [
  // ── Files to lint ──────────────────────────────────────────────────────────
  {
    files: ["src/**/*.js", "tests/**/*.js"],
    ignores: ["node_modules/**"],
  },

  // ── Security rules (SAST) ──────────────────────────────────────────────────
  // eslint-plugin-security recommended flat-config object
  security.configs.recommended,

  // ── Core quality / code-smell rules ───────────────────────────────────────
  {
    files: ["src/**/*.js", "tests/**/*.js"],
    rules: {
      // ---- possible errors --------------------------------------------------
      "no-unused-vars": ["warn", { args: "after-used", caughtErrors: "none" }],
      "no-undef": "error",
      "no-console": "off",          // extension legitimately uses console.*

      // ---- best practices / code smells ------------------------------------
      "eqeqeq": ["error", "always", { null: "ignore" }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "no-proto": "error",
      "no-extend-native": "error",
      "no-var": "warn",
      "prefer-const": "warn",
      "complexity": ["warn", 15],
      "max-depth": ["warn", 4],
      "max-lines-per-function": ["warn", { max: 80, skipBlankLines: true, skipComments: true }],

      // ---- style / readability ---------------------------------------------
      "curly": ["warn", "all"],
      "no-else-return": "warn",
      "no-lonely-if": "warn",
      "no-multi-assign": "warn",
      "no-nested-ternary": "warn",
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        // Browser / extension globals
        window: "readonly",
        document: "readonly",
        fetch: "readonly",
        console: "readonly",
        URL: "readonly",
        alert: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        // Thunderbird extension global
        messenger: "readonly",
        // Node.js globals (used in test helpers and server.js)
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        // Jest globals
        describe: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly",
        global: "readonly",
      },
    },
  },
  // ── Relax some rules for test files ──────────────────────────────────────
  {
    files: ["tests/**/*.js"],
    rules: {
      // Test files contain large describe/it blocks by design
      "max-lines-per-function": "off",
      // Tests intentionally use all patterns; relax security noise
      "security/detect-object-injection": "off",
      "security/detect-unsafe-regex": "off",
      "security/detect-non-literal-fs-filename": "off",
    },
  },
];
