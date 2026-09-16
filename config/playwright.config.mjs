import {defineConfig, devices} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {availableParallelism} from 'node:os';
import site from './site.config.json' with {type: 'json'};
const baseURL = `http://127.0.0.1:4173${site.base}`;
export default defineConfig({
  testDir: '../tests/browser',
  outputDir: '../test-results',
  fullyParallel: true,
  workers: process.env.CI ? 2 : Math.min(4, availableParallelism()),
  timeout: 30000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  reporter: process.env.CI ? [['line'], ['html', {open: 'never'}]] : 'list',
  use: {baseURL, trace: 'on-first-retry', screenshot: 'only-on-failure'},
  projects: [
    {name: 'chromium', use: {browserName: 'chromium'}},
    {name: 'firefox', use: {browserName: 'firefox'}},
    {name: 'webkit', use: {browserName: 'webkit'}},
    {name: 'chromium-mobile', use: {...devices['Pixel 7'], browserName: 'chromium'}},
    {name: 'webkit-mobile', use: {...devices['iPhone 13'], browserName: 'webkit'}},
  ],
  webServer: {cwd: fileURLToPath(new URL('../', import.meta.url)), command: 'node node_modules/vite/bin/vite.js preview --config config/vite.config.mjs --host 127.0.0.1 --port 4173', url: baseURL, reuseExistingServer: !process.env.CI},
});
