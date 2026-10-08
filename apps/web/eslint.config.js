import { config } from "@apuracao/config/eslint";
import nextPlugin from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { fileURLToPath } from "node:url";

const resolve = (name) => fileURLToPath(import.meta.resolve(name));

// eslint-config-next isn't used: it pulls typescript-eslint, which doesn't support
// TypeScript 7 (CLAUDE.md toolchain quirks). Its plugins are applied directly on top of
// the repo's Babel-parsed base config instead.

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  { files: ["**/*.{ts,tsx}"] },
  {
    files: ["**/*.tsx"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: [resolve("@babel/preset-typescript"), [resolve("@babel/preset-react"), { runtime: "automatic" }]],
        },
      },
    },
    rules: { "no-undef": "off", "no-unused-vars": "off" },
  },
  nextPlugin.configs["core-web-vitals"],
  reactHooks.configs.flat["recommended-latest"] ?? reactHooks.configs.flat.recommended,
  jsxA11y.flatConfigs.strict,
  { ignores: [".next/**", "out/**", ".perf/**", "test-results/**", "playwright-report/**", "next-env.d.ts"] },
];
