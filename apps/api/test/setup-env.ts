import path from 'node:path';
import { config as loadEnv } from 'dotenv';

// Load the committed, secret-free test env before any test module is evaluated.
loadEnv({ path: path.resolve(__dirname, '../.env.test'), quiet: true });
