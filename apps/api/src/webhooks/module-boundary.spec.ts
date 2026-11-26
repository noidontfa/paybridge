import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// The webhooks module reaches Payment Core and identity only through their
// public ports (`pnpm lint`, with the real `.oxlintrc.json`).

const run = promisify(execFile);
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const oxlintBin = join(apiRoot, 'node_modules', '.bin', 'oxlint');

async function lintSample(
  files: Record<string, string>,
): Promise<{ exitCode: number; output: string }> {
  const root = await mkdtemp(join(tmpdir(), 'paybridge-webhooks-boundary-'));
  try {
    await copyFile(
      join(apiRoot, '.oxlintrc.json'),
      join(root, '.oxlintrc.json'),
    );
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    try {
      const { stdout, stderr } = await run(
        oxlintBin,
        ['-c', join(root, '.oxlintrc.json'), join(root, 'src')],
        { cwd: root },
      );
      return { exitCode: 0, output: stdout + stderr };
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: typeof e.code === 'number' ? e.code : 1,
        output: `${e.stdout ?? ''}${e.stderr ?? ''}`,
      };
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const others = {
  'src/payment-core/domain/records.ts':
    'export type OutboxEventType = string;\n',
  'src/payment-core/port/outbox.ts':
    "export type { OutboxEventType } from '../domain/records.js';\n",
  'src/identity/domain/entities/organization.ts':
    "export const DEFAULT_ORGANIZATION_ID = 'x';\n",
  'src/identity/port/index.ts':
    "export { DEFAULT_ORGANIZATION_ID } from '../domain/entities/organization.js';\n",
};

describe('webhooks module boundary (pnpm lint)', () => {
  it('fails when webhooks imports Payment Core internals', async () => {
    const result = await lintSample({
      ...others,
      'src/webhooks/application/uses-core.ts':
        "import type { OutboxEventType } from '../../payment-core/domain/records.js';\n" +
        'export type T = OutboxEventType;\n',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('no-restricted-imports');
    expect(result.output).toContain('uses-core.ts');
  });

  it('fails when webhooks imports identity internals', async () => {
    const result = await lintSample({
      ...others,
      'src/webhooks/application/uses-identity.ts':
        "import { DEFAULT_ORGANIZATION_ID } from '../../identity/domain/entities/organization.js';\n" +
        'export const id = DEFAULT_ORGANIZATION_ID;\n',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('uses-identity.ts');
  });

  it('allows the Payment Core and identity ports', async () => {
    const result = await lintSample({
      ...others,
      'src/webhooks/application/uses-ports.ts':
        "import type { OutboxEventType } from '../../payment-core/port/outbox.js';\n" +
        "import { DEFAULT_ORGANIZATION_ID } from '../../identity/port/index.js';\n" +
        'export type T = OutboxEventType;\n' +
        'export const id = DEFAULT_ORGANIZATION_ID;\n',
    });

    expect(result.output).not.toContain('no-restricted-imports');
    expect(result.exitCode).toBe(0);
  });
});
