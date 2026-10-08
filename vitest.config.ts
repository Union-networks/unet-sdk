import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Private experiments own their runtimes and test runners.
    exclude: [...configDefaults.exclude, 'experiments/**'],
  },
});
