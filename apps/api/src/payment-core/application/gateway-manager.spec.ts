import type { PaymentGateway } from '../port/index.js';
import {
  fixedPlugin,
  type GatewayRegistration,
} from '../port/gateway-plugin-factory.js';
import {
  DuplicateGatewayError,
  GatewayManager,
  MissingGatewayError,
  UnknownGatewayError,
} from './gateway-manager.js';

function plugin(gatewayId: string): PaymentGateway {
  return {
    gatewayId,
    capabilities: { supportsCancel: false },
    initiate: vi.fn(),
    query: vi.fn(),
    parseCallback: vi.fn(),
  };
}

function reg(
  gatewayId: string,
  credentials: unknown = {},
): { registration: GatewayRegistration; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn((_credentials: unknown) => plugin(gatewayId));
  return {
    registration: { factory: { gatewayId, create }, credentials },
    create,
  };
}

describe('GatewayManager', () => {
  it('resolves each registered plugin by its gateway identifier', () => {
    const vnpay = plugin('vnpay');
    const zalopay = plugin('zalopay');
    const manager = new GatewayManager([
      fixedPlugin(vnpay),
      fixedPlugin(zalopay),
    ]);

    expect(manager.resolve('vnpay')).toBe(vnpay);
    expect(manager.resolve('zalopay')).toBe(zalopay);
    expect(manager.gatewayIds()).toEqual(['vnpay', 'zalopay']);
  });

  it('fails at boot on a duplicate gateway identifier', () => {
    expect(
      () =>
        new GatewayManager([
          fixedPlugin(plugin('vnpay')),
          fixedPlugin(plugin('vnpay')),
        ]),
    ).toThrow(DuplicateGatewayError);
    expect(
      () =>
        new GatewayManager([
          fixedPlugin(plugin('vnpay')),
          fixedPlugin(plugin('vnpay')),
        ]),
    ).toThrow(/Duplicate Gateway Plugin registration for gateway "vnpay"/);
  });

  it('fails at boot when a required gateway has no plugin', () => {
    expect(
      () =>
        new GatewayManager([fixedPlugin(plugin('vnpay'))], {
          requiredGatewayIds: ['vnpay', 'stripe'],
        }),
    ).toThrow(/No Gateway Plugin registered for required gateway "stripe"/);
  });

  it('fails at boot when a registration is empty or has no gateway identifier', () => {
    expect(
      () => new GatewayManager([undefined as unknown as GatewayRegistration]),
    ).toThrow(MissingGatewayError);
    expect(() => new GatewayManager([fixedPlugin(plugin(''))])).toThrow(
      MissingGatewayError,
    );
  });

  it('fails with a clear error when resolving an unregistered gateway', () => {
    const manager = new GatewayManager([fixedPlugin(plugin('vnpay'))]);

    expect(() => manager.resolve('momo')).toThrow(UnknownGatewayError);
    expect(() => manager.resolve('momo')).toThrow(
      'No Gateway Plugin registered for gateway "momo" (registered: vnpay)',
    );
  });

  it('builds an instance from the registered credentials, once, on first use', () => {
    const { registration: stripe, create } = reg('stripe', {
      secretKey: 'sk_1',
    });
    const manager = new GatewayManager([stripe]);
    expect(create).not.toHaveBeenCalled();

    const first = manager.resolve('stripe');
    const second = manager.resolve('stripe');

    expect(first.gatewayId).toBe('stripe');
    expect(second).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ secretKey: 'sk_1' });
  });

  it('builds a separate instance per gateway', () => {
    const a = reg('a');
    const b = reg('b');
    const manager = new GatewayManager([a.registration, b.registration]);

    expect(manager.resolve('a')).not.toBe(manager.resolve('b'));
    expect(a.create).toHaveBeenCalledTimes(1);
    expect(b.create).toHaveBeenCalledTimes(1);
  });

  it('caches by a key that distinguishes connections and credentials versions', () => {
    const { registration: stripe, create } = reg('stripe');
    const manager = new GatewayManager([stripe]);

    const base = manager.resolve('stripe');
    const conn1v1 = manager.resolve('stripe', {
      connectionId: 'c1',
      credentialsVersion: 1,
    });
    const conn1v2 = manager.resolve('stripe', {
      connectionId: 'c1',
      credentialsVersion: 2,
    });

    expect(new Set([base, conn1v1, conn1v2]).size).toBe(3);
    expect(
      manager.resolve('stripe', { connectionId: 'c1', credentialsVersion: 1 }),
    ).toBe(conn1v1);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('builds a Gateway Connection instance from its credentials, cached by id and version', () => {
    const { registration: stripe, create } = reg('stripe', {
      secretKey: 'env',
    });
    const manager = new GatewayManager([stripe]);
    const conn = (version: number, secretKey: string) => ({
      id: 'c1',
      credentialsVersion: version,
      credentials: { secretKey },
    });

    const v1 = manager.resolveForConnection('stripe', conn(1, 'sk_a'));
    expect(manager.resolveForConnection('stripe', conn(1, 'sk_a'))).toBe(v1);
    const v2 = manager.resolveForConnection('stripe', conn(2, 'sk_b'));

    expect(v2).not.toBe(v1);
    expect(create).toHaveBeenCalledWith({ secretKey: 'sk_a' });
    expect(create).toHaveBeenCalledWith({ secretKey: 'sk_b' });
    expect(create).not.toHaveBeenCalledWith({ secretKey: 'env' });
  });

  it('uses the registered default instance for a connection without credentials', () => {
    const fake = plugin('fake');
    const manager = new GatewayManager([fixedPlugin(fake)]);
    expect(
      manager.resolveForConnection('fake', {
        id: 'c1',
        credentialsVersion: 1,
        credentials: null,
      }),
    ).toBe(fake);
  });
});
