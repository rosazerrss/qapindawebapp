import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',

    // Compiled Cloud Functions output — linting generated CommonJS reports
    // hundreds of `require` errors about code nobody wrote by hand.
    'functions/lib/**',
    'functions/node_modules/**',

    // Generated copies of /shared. The originals are linted; these are not.
    'src/shared/**',
    'functions/src/shared/**',
  ]),
]);

export default eslintConfig;
