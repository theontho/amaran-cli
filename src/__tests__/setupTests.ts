// Setup test environment before running tests

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalStorage } from 'node-localstorage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create a temporary directory for test local storage
const TEST_STORAGE_DIR = join(__dirname, '.test-storage');

try {
  // Ensure the test storage directory exists
  mkdirSync(TEST_STORAGE_DIR, { recursive: true });

  // Set up global localStorage for tests
  global.localStorage = new LocalStorage(TEST_STORAGE_DIR);
} catch (error) {
  console.error('Failed to set up test storage:', error);
  process.exit(1);
}

// Mock any other global objects if needed
process.env.NODE_ENV = 'test';
