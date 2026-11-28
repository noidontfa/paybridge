import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';

const run = promisify(execFile);

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coreDir = join(apiRoot, 'src', 'payment-core');
const gatewaysDir = join(apiRoot, 'src', 'gateways');
const oxlintBin = join(apiRoot, 'node_modules', '.bin', 'oxlint');

/**
 * Lints `files` (paths relative to a scratch copy of `apps/api`) with the
 * real `.oxlintrc.json`, the same config `pnpm lint` uses.
 */
async function lintSample(
  files: Record<string, string>,
): Promise<{ exitCode: number; output: string }> {
  const root = await mkdtemp(join(tmpdir(), 'paybridge-core-boundary-'));
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

const pluginSource = `export class SomePlugin { readonly gatewayId = 'some'; }\n`;

describe('Core dependency rule (pnpm lint)', () => {
  it('fails when a Core module imports a Gateway Plugin', async () => {
    const result = await lintSample({
      'src/gateways/some/some.plugin.ts': pluginSource,
      'src/payment-core/application/uses-plugin.ts':
        "import { SomePlugin } from '../../gateways/some/some.plugin.js';\n" +
        'export const plugin = new SomePlugin();\n',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('no-restricted-imports');
    expect(result.output).toContain('uses-plugin.ts');
  });

  it('fails on a type-only import and a re-export from a plugin', async () => {
    const result = await lintSample({
      'src/gateways/some/some.plugin.ts': pluginSource,
      'src/payment-core/port/leak.ts':
        "export type { SomePlugin } from '../../gateways/some/some.plugin.js';\n",
      'src/payment-core/types-only.ts':
        "import type { SomePlugin } from '../gateways/some/some.plugin.js';\n" +
        'export type P = SomePlugin;\n',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('leak.ts');
    expect(result.output).toContain('types-only.ts');
  });

  it('allows the composition root to import Core and plugins', async () => {
    const result = await lintSample({
      'src/gateways/some/some.plugin.ts': pluginSource,
      'src/payment-core/port/index.ts': 'export interface PaymentGateway {}\n',
      'src/gateways/gateways.module.ts':
        "import type { PaymentGateway } from '../payment-core/port/index.js';\n" +
        "import { SomePlugin } from './some/some.plugin.js';\n" +
        'export const plugins: PaymentGateway[] = [new SomePlugin()];\n',
    });

    expect(result.output).not.toContain('no-restricted-imports');
    expect(result.exitCode).toBe(0);
  });

  it('allows Core to import its own gateway port and Gateway Manager', async () => {
    const result = await lintSample({
      'src/payment-core/port/index.ts': 'export interface PaymentGateway {}\n',
      'src/payment-core/application/gateway-manager.ts':
        "import type { PaymentGateway } from '../port/index.js';\n" +
        'export type Plugins = PaymentGateway[];\n',
      'src/payment-core/application/uses-manager.ts':
        "import type { Plugins } from './gateway-manager.js';\n" +
        'export type P = Plugins;\n',
    });

    expect(result.output).not.toContain('no-restricted-imports');
    expect(result.exitCode).toBe(0);
  });
});

describe('Core reaches identity only through its port (pnpm lint)', () => {
  const identityFiles = {
    'src/identity/domain/entities/organization.ts':
      "export const DEFAULT_ORGANIZATION_ID = 'x';\n",
    'src/identity/port/index.ts':
      "export { DEFAULT_ORGANIZATION_ID } from '../domain/entities/organization.js';\n",
  };

  it('fails when Core imports identity internals', async () => {
    const result = await lintSample({
      ...identityFiles,
      'src/payment-core/application/uses-internal.ts':
        "import { DEFAULT_ORGANIZATION_ID } from '../../identity/domain/entities/organization.js';\n" +
        'export const id = DEFAULT_ORGANIZATION_ID;\n',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('no-restricted-imports');
    expect(result.output).toContain('uses-internal.ts');
  });

  it('allows Core to import the identity port', async () => {
    const result = await lintSample({
      ...identityFiles,
      'src/payment-core/application/uses-port.ts':
        "import { DEFAULT_ORGANIZATION_ID } from '../../identity/port/index.js';\n" +
        'export const id = DEFAULT_ORGANIZATION_ID;\n',
    });

    expect(result.output).not.toContain('no-restricted-imports');
    expect(result.exitCode).toBe(0);
  });
});

describe('checkout reaches Core and identity only through their ports (pnpm lint)', () => {
  const coreFiles = {
    'src/payment-core/domain/value-objects/organization-scope.ts':
      'export interface OrganizationScope { organizationId: string }\n',
    'src/payment-core/port/organization-scope.ts':
      "export type { OrganizationScope } from '../domain/value-objects/organization-scope.js';\n",
  };

  it('fails when checkout imports Core or identity internals', async () => {
    const result = await lintSample({
      ...coreFiles,
      'src/identity/domain/entities/organization.ts':
        "export const DEFAULT_ORGANIZATION_ID = 'x';\n",
      'src/checkout/application/uses-core.ts':
        "import type { OrganizationScope } from '../../payment-core/domain/value-objects/organization-scope.js';\n" +
        'export type S = OrganizationScope;\n',
      'src/checkout/application/uses-identity.ts':
        "import { DEFAULT_ORGANIZATION_ID } from '../../identity/domain/entities/organization.js';\n" +
        'export const id = DEFAULT_ORGANIZATION_ID;\n',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('uses-core.ts');
    expect(result.output).toContain('uses-identity.ts');
  });

  it('allows checkout to import a Core port file', async () => {
    const result = await lintSample({
      ...coreFiles,
      'src/checkout/application/uses-port.ts':
        "import type { OrganizationScope } from '../../payment-core/port/organization-scope.js';\n" +
        'export type S = OrganizationScope;\n',
    });

    expect(result.output).not.toContain('no-restricted-imports');
    expect(result.exitCode).toBe(0);
  });
});

describe('Core public surface', () => {
  it('exports no plugin types or values from any Core module', () => {
    const coreFiles = ts.sys
      .readDirectory(coreDir, ['.ts'])
      .filter((file) => !file.endsWith('.spec.ts'));
    expect(coreFiles.length).toBeGreaterThan(0);

    const program = ts.createProgram(coreFiles, {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2023,
      experimentalDecorators: true,
      noEmit: true,
      skipLibCheck: true,
    });
    const checker = program.getTypeChecker();

    const leaks: string[] = [];
    for (const file of coreFiles) {
      const source = program.getSourceFile(file);
      const moduleSymbol = source && checker.getSymbolAtLocation(source);
      if (!moduleSymbol) continue;
      for (const exported of checker.getExportsOfModule(moduleSymbol)) {
        const target =
          exported.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(exported)
            : exported;
        for (const declaration of target.declarations ?? []) {
          const origin = resolve(declaration.getSourceFile().fileName);
          if (origin.startsWith(gatewaysDir + sep)) {
            leaks.push(
              `${relative(apiRoot, file)} exports ${exported.name} from ${relative(apiRoot, origin)}`,
            );
          }
        }
      }
    }

    expect(leaks).toEqual([]);
    // Type-checks all of Payment Core: under 1 s locally, over 5 s on CI runners.
  }, 10_000);
});
