import {spawnSync} from 'node:child_process';
import {delimiter, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Browser tests require Node.js 24 or newer. Select the version in .nvmrc and try again.');
  process.exit(1);
}

// Keep installation and test execution on the same project-local browser cache.
// A fresh cache also avoids the Windows side-by-side launch failure observed in
// the shared Firefox installation. Honor an explicitly selected Playwright cache.
const env = {
  ...process.env,
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? fileURLToPath(new URL('../.work/playwright-browsers', import.meta.url)),
};
// Vite's preview server must use the same supported Node version as this runner.
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
env[pathKey] = `${dirname(process.execPath)}${delimiter}${env[pathKey] ?? ''}`;
const result = spawnSync(process.execPath, [
  fileURLToPath(import.meta.resolve('@playwright/test/cli')),
  ...process.argv.slice(2),
], {cwd: fileURLToPath(new URL('..', import.meta.url)), env, stdio: 'inherit'});
if (result.error) console.error(`Could not start Playwright: ${result.error.message}`);
process.exit(result.status ?? 1);
