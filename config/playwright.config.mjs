import {defineConfig, devices} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import site from './site.config.json' with {type: 'json'};
const baseURL = `http://127.0.0.1:4173${site.base}`;
export default defineConfig({
  testDir: '../tests/browser',
  outputDir: '../test-results',
  fullyParallel: true,
  workers: 2,
  timeout: 45000,
  expect: {timeout: 10000},
  use: {baseURL, trace: 'retain-on-failure'},
  projects: [
    {name: 'chromium', use: {browserName: 'chromium'}},
    {name: 'firefox', use: {browserName: 'firefox'}},
    {name: 'webkit', use: {browserName: 'webkit'}},
    {name: 'chromium-mobile', use: {...devices['Pixel 7'], browserName: 'chromium'}},
    {name: 'webkit-mobile', use: {...devices['iPhone 13'], browserName: 'webkit'}},
  ],
  webServer: {command: 'npm run preview', cwd: fileURLToPath(new URL('../', import.meta.url)), url: baseURL, reuseExistingServer: !process.env.CI},
});
