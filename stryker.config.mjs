// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: "npm",
  // @stryker-mutator/vitest-runner 10.0.0 does not see mutants under Vitest 5 (every mutant survives); keep vitest on ^4.
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  typescriptChecker: { prioritizePerformanceOverAccuracy: true },
  // Pure TS logic only; payout arithmetic lives in SQL and is covered by pgTAP (supabase test db).
  mutate: ["src/lib/**/*.ts", "!src/lib/**/*.test.ts", "!src/lib/supabase.ts"],
  coverageAnalysis: "perTest",
  reporters: ["html", "clear-text", "progress"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: ".stryker-tmp",
  // Keep the sandbox copy small: build output, DB tests and docs are irrelevant to TS mutants.
  ignorePatterns: ["dist", ".astro", ".wrangler", "supabase", "context", "docs", "reports", "coverage"],
};
