import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Build-time checks of Core's boundaries (run by `pnpm test`):
// 1. The transaction runner is the only code that opens a database transaction.
// 2. Outside `infrastructure/prisma`, Core never imports the database client,
//    so repositories are the only place that sees Prisma types.

const SRC = join(import.meta.dirname, '..');
const RUNNER = 'payment-core/infrastructure/prisma/transaction-runner.ts';
const PRISMA_ADAPTER_DIR = 'payment-core/infrastructure/prisma/';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : sourceFiles(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}));

/** Files (other than the runner) that open a transaction. */
export function transactionOpeners(
  sources: readonly { path: string; text: string }[],
): string[] {
  return sources
    .filter((f) => f.path !== RUNNER && /\$transaction\b/.test(f.text))
    .map((f) => f.path);
}

/** Core files outside the Prisma adapter that import the database client. */
export function databaseClientImporters(
  sources: readonly { path: string; text: string }[],
): string[] {
  const importsClient =
    /from\s+['"][^'"]*(generated\/prisma|@prisma\/client|database\/prisma\.service)[^'"]*['"]/;
  return sources
    .filter(
      (f) =>
        f.path.startsWith('payment-core/') &&
        !f.path.startsWith(PRISMA_ADAPTER_DIR) &&
        importsClient.test(f.text),
    )
    .map((f) => f.path);
}

describe('transaction boundary', () => {
  it('only the transaction runner calls $transaction', () => {
    expect(transactionOpeners(files)).toEqual([]);
  });

  it('flags any other file that calls $transaction', () => {
    expect(
      transactionOpeners([
        { path: RUNNER, text: 'this.prisma.$transaction(fn)' },
        {
          path: 'payment-core/application/use-cases/x.ts',
          text: 'await prisma.$transaction(async (tx) => {})',
        },
        { path: 'health/health.controller.ts', text: 'prisma.$queryRaw`1`' },
      ]),
    ).toEqual(['payment-core/application/use-cases/x.ts']);
  });

  it('is actually scanning the source tree', () => {
    expect(files.map((f) => f.path)).toContain(RUNNER);
  });
});

describe('repositories hide the database client', () => {
  it('no Core module outside infrastructure/prisma imports Prisma', () => {
    expect(databaseClientImporters(files)).toEqual([]);
  });

  it('flags a Core module that imports Prisma', () => {
    expect(
      databaseClientImporters([
        {
          path: 'payment-core/application/use-cases/x.ts',
          text: "import type { Payment } from '../../../generated/prisma/client.js';",
        },
        {
          path: 'payment-core/domain/y.ts',
          text: "import { PrismaService } from '../../database/prisma.service.js';",
        },
        {
          path: 'payment-core/infrastructure/prisma/mappers.ts',
          text: "import { Prisma } from '../../../generated/prisma/client.js';",
        },
      ]),
    ).toEqual([
      'payment-core/application/use-cases/x.ts',
      'payment-core/domain/y.ts',
    ]);
  });
});
