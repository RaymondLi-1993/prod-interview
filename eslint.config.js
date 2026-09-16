import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    // db/*.mjs are standalone scripts run directly by node, and
    // vitest.config.ts is tooling config — neither belongs to a tsconfig
    // project, so type-aware linting has nothing to check them against.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.js",
      "**/*.mjs",
      "vitest.config.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Project rule: no `any`, no non-null assertions.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",

      // Unhandled promises are the most common async bug in Node.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",

      // Allow intentionally unused args when prefixed with _.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Type-only imports must say so — Node strips types at runtime.
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },

  // Must stay last: disables stylistic rules that conflict with Prettier.
  prettier,
);
