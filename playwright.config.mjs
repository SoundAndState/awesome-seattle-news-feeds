import {defineConfig} from '@playwright/test';
import site from './site.config.json' with {type: 'json'};
const baseURL = `http://127.0.0.1:4173${site.base}`;
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  timeout: 45000,
  use: {baseURL, trace: 'retain-on-failure'},
  webServer: {command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173', url: baseURL, reuseExistingServer: !process.env.CI},
});
