import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "path";
import { fileURLToPath } from "url";
import reactReviewShim from "./eslint-plugins/react-review-shim.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "drizzle/**",
      "coverage/**",
    ],
  },
  {
    // The react.review suppressors below show up locally as "Unused
    // eslint-disable directive" because the shim plugin reports no real
    // problems. They are NOT unused — they target react.review's
    // server-side rule registry, not local ESLint. Silence the meta
    // warning project-wide.
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  {
    // Register React Review's rule IDs as no-op locals so that the
    // suppression comments scattered across the codebase don't blow up
    // `pnpm lint`. The actual linting happens at react.review on push;
    // the shim just teaches local ESLint that these IDs exist.
    plugins: { "react-review": reactReviewShim },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
    },
  },
];

export default eslintConfig;
