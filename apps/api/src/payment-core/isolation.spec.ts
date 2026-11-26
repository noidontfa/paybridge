import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

// Static isolation check (ADR 0006): Organization isolation is enforced in the
// application, so every repository method that touches Organization data must
// take an explicit Organization scope as its first parameter. A repository
// that forgets it would leak data between Organizations, so the build fails.

const SRC = join(import.meta.dirname, '..');
const PRISMA_ADAPTER = 'payment-core/infrastructure/prisma/';

function repositoryFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : repositoryFiles(path);
    }
    return entry.name.endsWith('.repository.ts') ? [path] : [];
  });
}

/**
 * `file#Class.method` for every public repository method, and
 * `file#function` for every exported function, whose first parameter is not
 * named `scope`.
 */
export function unscopedRepositoryMembers(
  sources: readonly { path: string; text: string }[],
): string[] {
  const offenders: string[] = [];
  for (const { path, text } of sources) {
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.ES2023, true);
    const firstParameterIsScope = (
      parameters: ts.NodeArray<ts.ParameterDeclaration>,
    ): boolean => parameters[0]?.name.getText(file) === 'scope';

    for (const statement of file.statements) {
      if (ts.isClassDeclaration(statement) && statement.name) {
        for (const member of statement.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          const modifiers = ts.getModifiers(member) ?? [];
          const isPrivate = modifiers.some(
            (m) =>
              m.kind === ts.SyntaxKind.PrivateKeyword ||
              m.kind === ts.SyntaxKind.ProtectedKeyword,
          );
          if (isPrivate || ts.isPrivateIdentifier(member.name)) continue;
          if (!firstParameterIsScope(member.parameters)) {
            offenders.push(
              `${path}#${statement.name.text}.${member.name.getText(file)}`,
            );
          }
        }
      } else if (
        ts.isFunctionDeclaration(statement) &&
        statement.name &&
        ts
          .getModifiers(statement)
          ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
        !firstParameterIsScope(statement.parameters)
      ) {
        offenders.push(`${path}#${statement.name.text}`);
      }
    }
  }
  return offenders;
}

/** Modules whose repositories hold Organization data, scope first. */
const SCANNED_MODULES = ['payment-core', 'checkout', 'webhooks'] as const;

const files = SCANNED_MODULES.flatMap((module) =>
  repositoryFiles(join(SRC, module)),
).map((path) => ({
  path: relative(SRC, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}));

describe('Organization isolation (static)', () => {
  it('is actually scanning the repositories', () => {
    const paths = files.map((f) => f.path);
    expect(paths).toContain(`${PRISMA_ADAPTER}payment.repository.ts`);
    expect(paths).toContain(
      `${PRISMA_ADAPTER}console-read/payments-read.repository.ts`,
    );
    expect(paths).toContain(
      'checkout/infrastructure/prisma/pricing-plan.repository.ts',
    );
    expect(paths).toContain(
      'checkout/domain/repositories/pricing-plan.repository.ts',
    );
    expect(paths).toContain(
      'webhooks/infrastructure/prisma/webhook-endpoint.repository.ts',
    );
    expect(paths).toContain(
      'webhooks/domain/repositories/webhook-delivery.repository.ts',
    );
  });

  it('every repository method takes an Organization scope first', () => {
    expect(unscopedRepositoryMembers(files)).toEqual([]);
  });

  it('flags a method with no scope', () => {
    expect(
      unscopedRepositoryMembers([
        {
          path: 'x.repository.ts',
          text: `export class XRepository {
            async findById(id: string) { return id; }
          }`,
        },
      ]),
    ).toEqual(['x.repository.ts#XRepository.findById']);
  });

  it('flags a scope that is not the first parameter', () => {
    expect(
      unscopedRepositoryMembers([
        {
          path: 'x.repository.ts',
          text: `export class XRepository {
            async findById(id: string, scope: unknown) { return [id, scope]; }
          }`,
        },
      ]),
    ).toEqual(['x.repository.ts#XRepository.findById']);
  });

  it('flags an exported query builder with no scope', () => {
    expect(
      unscopedRepositoryMembers([
        {
          path: 'x.repository.ts',
          text: 'export function expiredQuery(now: Date) { return now; }',
        },
      ]),
    ).toEqual(['x.repository.ts#expiredQuery']);
  });

  it('accepts scoped methods, private helpers and the constructor', () => {
    expect(
      unscopedRepositoryMembers([
        {
          path: 'x.repository.ts',
          text: `export class XRepository {
            constructor(private readonly ctx: unknown) {}
            async list(scope: unknown, limit: number) { return [scope, limit]; }
            private where(query: unknown) { return query; }
          }`,
        },
      ]),
    ).toEqual([]);
  });
});
