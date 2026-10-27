import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The e2e run starts its own Flask (5001) and Vite (5174) servers on a throwaway database,
// so the real servers on 5000/5173 and instance/oneflow.db are never touched.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = path.join(root, 'tests', '.e2e');
const dbFile = path.join(dbDir, 'oneflow-e2e.db');
export const TEST_API = 'http://127.0.0.1:5001';
// Set ONEFLOW_E2E_BASE_URL to test an already-running server (e.g. a production build) instead; it must have ONEFLOW_TEST_LOGIN=1.
const external = process.env.ONEFLOW_E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // tests share one test database
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: external || 'http://localhost:5174',
    timezoneId: 'America/Chicago',
    locale: 'en-US',
    viewport: { width: 1400, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 1000 } } }],
  webServer: external ? [] : [
    {
      command: `mkdir -p "${dbDir}" && rm -f "${dbFile}" && .venv/bin/python -m flask --app app run --port 5001`,
      cwd: root,
      url: `${TEST_API}/api/health`,
      // test-only login on, .env ignored so real settings (owner, client id) never leak into tests
      env: { ONEFLOW_DATABASE_URI: `sqlite:///${dbFile}`, ONEFLOW_TEST_LOGIN: '1', FLASK_SKIP_DOTENV: '1', SECRET_KEY: 'e2e-secret', GOOGLE_CLIENT_ID: '', OWNER_EMAIL: '', DATABASE_URL: '', RENDER: '' },
      reuseExistingServer: false,
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      env: { ONEFLOW_API_URL: TEST_API },
      reuseExistingServer: false,
    },
  ],
});
