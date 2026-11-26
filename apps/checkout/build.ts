import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as esbuild from 'esbuild';

// Builds the checkout app into dist/:
//   dist/public/paybridge.js  the SDK (served at /v1/paybridge.js and /v<version>/paybridge.js)
//   dist/public/checkout.js   the checkout page's script
//   dist/server.js            the Node server
// `--watch` rebuilds on change and restarts the server (pnpm dev).

const watch = process.argv.includes('--watch');
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

const browser: esbuild.BuildOptions = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
};

let server: ChildProcess | undefined;
let restart: NodeJS.Timeout | undefined;
let pending = 3;
// Restarts once every bundle exists, and after each later rebuild (debounced).
const restartServer: esbuild.Plugin = {
  name: 'restart-server',
  setup(build) {
    let first = true;
    build.onEnd((result) => {
      if (first) {
        first = false;
        pending--;
      }
      if (result.errors.length > 0 || pending > 0) return;
      clearTimeout(restart);
      restart = setTimeout(() => {
        server?.kill();
        server = spawn(process.execPath, ['dist/server.js'], { stdio: 'inherit' });
      }, 150);
    });
  },
};

const builds: esbuild.BuildOptions[] = [
  { ...browser, entryPoints: ['src/sdk/index.ts'], outfile: 'dist/public/paybridge.js' },
  { ...browser, entryPoints: ['src/page/main.ts'], outfile: 'dist/public/checkout.js' },
  {
    entryPoints: ['src/server/main.ts'],
    outfile: 'dist/server.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    packages: 'external',
    define: { __PAYBRIDGE_VERSION__: JSON.stringify(version) },
    logLevel: 'info',
  },
];

if (watch) {
  const contexts = await Promise.all(
    builds.map((options) => esbuild.context({ ...options, plugins: [restartServer] })),
  );
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
