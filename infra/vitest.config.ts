import { configDefaults, defineConfig } from 'vitest/config';

// cdk.out/ holds staged Docker build contexts (a copy of the repo, tests included).
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'cdk.out/**'] },
});
