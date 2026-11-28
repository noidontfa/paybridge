import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_PORT, CHECKOUT_URL, DATABASE_NAME, DATABASE_URL } from './env.js';

// Playwright's API server: migrates and seeds the run's own database, then
// starts the real API (apps/api) in development mode, where the fake
// gateways are registered and the checkout app's origin is allowed.

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../api');
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  DATABASE_URL,
  QUEUE_PREFIX: DATABASE_NAME,
  LOG_LEVEL: 'warn',
  SWAGGER_ENABLED: 'false',
  CHECKOUT_APP_ORIGINS: CHECKOUT_URL,
  // Every test starts Payments from the same IP.
  CHECKOUT_START_RATE_LIMIT_PER_IP: '10000',
  CHECKOUT_START_RATE_LIMIT_PER_KEY: '10000',
};

function run(args: string[]): void {
  const result = spawnSync('pnpm', args, { cwd: apiDir, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['exec', 'prisma', 'migrate', 'deploy']);
run(['exec', 'tsx', 'seed/main.ts']);
const api = spawn('pnpm', ['exec', 'nest', 'start'], { cwd: apiDir, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => api.kill(signal));
}
api.on('exit', (code) => process.exit(code ?? 0));
