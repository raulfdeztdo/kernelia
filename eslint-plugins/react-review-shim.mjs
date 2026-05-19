/**
 * No-op plugin that registers React Review's rule IDs so that local
 * ESLint accepts `// eslint-disable-next-line <react-review-rule>`
 * comments without exploding with "Definition for rule X was not
 * found". The rules themselves do nothing here — the real linting
 * happens server-side at react.review on every push.
 *
 * Keep this list in sync with the rule IDs we suppress in code; add a
 * new entry whenever a new React Review diagnostic forces a per-line
 * disable comment somewhere.
 */
const noop = {
  meta: { type: "suggestion", schema: [], messages: {} },
  create: () => ({}),
};

const ruleIds = [
  "async-await-in-loop",
  "async-defer-await",
  "async-parallel",
  "click-events-have-key-events",
  "js-set-map-lookups",
  "nextjs-no-a-element",
  "nextjs-no-use-search-params-without-suspense",
  "no-derived-useState",
  "no-static-element-interactions",
  "prefer-dynamic-import",
  "react-compiler-destructure-method",
  "rendering-hydration-mismatch-time",
  "server-sequential-independent-await",
];

const rules = Object.fromEntries(ruleIds.map((id) => [id, noop]));

export default { rules };
