import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '.*\\.(spec|test)\\.ts$',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 30000,
  moduleFileExtensions: ['ts', 'js', 'json'],
};

export default config;
