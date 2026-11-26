import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Build-time checks of the module boundaries (run by `pnpm test`), for Payment
// Core and for the identity module, which is laid out the same way:
// 1. The transaction runner is the only code that opens a database transaction.
// 2. Outside `infrastructure/prisma`, a module never imports the database
//    client, so repositories are the only place that sees Prisma types.

const SRC = join(import.meta.dirname, '..');
const MODULES = ['payment-core', 'identity'] as const;
const RUNNERS: readonly string[] = MODULES.map(
  (module) => `${module}/infrastructure/prisma/transaction-runner.ts`,
);
const RUNNER = RUNNERS[0] as string;
const PRISMA_ADAPTER_DIRS: readonly string[] = MODULES.map(
  (module) => `${module}/infrastructure/prisma/`,
);

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
    .filter((f) => !RUNNERS.includes(f.path) && /\$transaction\b/.test(f.text))
    .map((f) => f.path);
}

/** Module files outside their Prisma adapter that import the database client. */
export function databaseClientImporters(
  sources: readonly { path: string; text: string }[],
): string[] {
  const importsClient =
    /from\s+['"][^'"]*(generated\/prisma|@prisma\/client|database\/prisma\.service)[^'"]*['"]/;
  return sources
    .filter(
      (f) =>
        MODULES.some((module) => f.path.startsWith(`${module}/`)) &&
        !PRISMA_ADAPTER_DIRS.some((dir) => f.path.startsWith(dir)) &&
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
    for (const runner of RUNNERS) {
      expect(files.map((f) => f.path)).toContain(runner);
    }
  });

  it('flags a transaction opened outside the identity runner', () => {
    expect(
      transactionOpeners([
        {
          path: 'identity/application/use-cases/x.ts',
          text: 'await prisma.$transaction(async (tx) => {})',
        },
      ]),
    ).toEqual(['identity/application/use-cases/x.ts']);
  });
});

describe('repositories hide the database client', () => {
  it('no Core module outside infrastructure/prisma imports Prisma', () => {
    expect(databaseClientImporters(files)).toEqual([]);
  });

  it('flags an identity module that imports Prisma outside its adapter', () => {
    expect(
      databaseClientImporters([
        {
          path: 'identity/application/use-cases/x.ts',
          text: "import { PrismaService } from '../../../database/prisma.service.js';",
        },
        {
          path: 'identity/infrastructure/prisma/organization.repository.ts',
          text: "import type { Organization } from '../../../generated/prisma/client.js';",
        },
      ]),
    ).toEqual(['identity/application/use-cases/x.ts']);
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

/** Application files that import from the HTTP layer. */
export function applicationImportsOfHttp(
  sources: readonly { path: string; text: string }[],
): string[] {
  const importsHttp = /from\s+['"](?:\.\.?\/)+http\/[^'"]*['"]/;
  return sources
    .filter(
      (f) =>
        f.path.startsWith('payment-core/application/') &&
        importsHttp.test(f.text),
    )
    .map((f) => f.path);
}

describe('application does not depend on http', () => {
  it('no application module imports from payment-core/http', () => {
    expect(applicationImportsOfHttp(files)).toEqual([]);
  });

  it('flags an application file that imports the HTTP layer', () => {
    expect(
      applicationImportsOfHttp([
        {
          path: 'payment-core/application/use-cases/x.ts',
          text: "import { y } from '../../http/y.js';",
        },
      ]),
    ).toEqual(['payment-core/application/use-cases/x.ts']);
  });
});
