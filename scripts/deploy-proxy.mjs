import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {loadCatalog, validateCatalog} from './catalog.mjs';

await validateCatalog(await loadCatalog());
if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment or ignored .env file.');
const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'config/wrangler.jsonc', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false'},
});
process.exit(result.status ?? 1);
