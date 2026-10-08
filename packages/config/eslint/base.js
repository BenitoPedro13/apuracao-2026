import babelParser from "@babel/eslint-parser";
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import onlyWarn from "eslint-plugin-only-warn";
import globals from "globals";

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  // Without this, flat config only lints .js/.mjs/.cjs and silently skips TypeScript.
  { files: ["**/*.{js,mjs,cjs,ts,mts,cts}"] },
  js.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: globals.node,
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ["@babel/preset-typescript"],
        },
      },
    },
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    // typescript-eslint doesn't support TypeScript 7 yet (peer range <6.1.0, checked
    // 2026-10-07), so TS is parsed by Babel and these core rules can't see types. They
    // misreport type names and type-only imports. The compiler covers both instead
    // (tsc reports undefined names; noUnusedLocals/noUnusedParameters in tsconfig).
    files: ["**/*.{ts,mts,cts}"],
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  {
    ignores: ["dist/**"],
  },
];
