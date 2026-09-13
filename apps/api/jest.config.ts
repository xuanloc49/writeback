import type { Config } from 'jest';

/**
 * Auth.js (`@auth/express`, `@auth/core`, `@auth/prisma-adapter`) and two of its dependencies
 * (`oauth4webapi`, `jose`) ship ESM only. Node ≥ 22.12 loads them via `require(esm)` at runtime,
 * but Jest's CommonJS runtime cannot, so those packages are transpiled to CJS on the fly.
 */
const ESM_ONLY_PACKAGES = ['@auth', 'oauth4webapi', 'jose'];

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '.*\\.(spec|test)\\.ts$',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 30000,
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': [
      'ts-jest',
      {
        diagnostics: false,
        tsconfig: {
          allowJs: true,
          isolatedModules: true,
          module: 'commonjs',
          target: 'es2022',
          esModuleInterop: true,
        },
      },
    ],
  },
  transformIgnorePatterns: [
    `[\\\\/]node_modules[\\\\/](?!.*(${ESM_ONLY_PACKAGES.join('|')})[\\\\/])`,
  ],
};

export default config;
