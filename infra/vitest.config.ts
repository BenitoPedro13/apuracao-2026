import { configDefaults, defineConfig } from 'vitest/config';

// cdk.out/ holds staged Docker build contexts (a copy of the repo, tests included).
// Synthesizing a stack with a Docker asset hashes the repo context: 1–3 s alone, past
// vitest's 5 s default when the full turbo run (testcontainers included) shares the CPU.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'cdk.out/**'], testTimeout: 30_000 },
});
