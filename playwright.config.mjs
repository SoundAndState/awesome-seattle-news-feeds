import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  timeout: 45000,
  use: {baseURL: 'http://127.0.0.1:4173/awesome-seattle-news-feeds/', trace: 'retain-on-failure'},
  webServer: {command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173/awesome-seattle-news-feeds/', reuseExistingServer: !process.env.CI},
});
