import type { PaymentGateway } from '../port/index.js';
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

describe('GatewayManager', () => {
  it('resolves each registered plugin by its gateway identifier', () => {
    const vnpay = plugin('vnpay');
    const zalopay = plugin('zalopay');
    const manager = new GatewayManager([vnpay, zalopay]);

    expect(manager.resolve('vnpay')).toBe(vnpay);
    expect(manager.resolve('zalopay')).toBe(zalopay);
    expect(manager.gatewayIds()).toEqual(['vnpay', 'zalopay']);
  });

  it('fails at boot on a duplicate gateway identifier', () => {
    expect(
      () => new GatewayManager([plugin('vnpay'), plugin('vnpay')]),
    ).toThrow(DuplicateGatewayError);
    expect(
      () => new GatewayManager([plugin('vnpay'), plugin('vnpay')]),
    ).toThrow(/Duplicate Gateway Plugin registration for gateway "vnpay"/);
  });

  it('fails at boot when a required gateway has no plugin', () => {
    expect(
      () =>
        new GatewayManager([plugin('vnpay')], {
          requiredGatewayIds: ['vnpay', 'stripe'],
        }),
    ).toThrow(/No Gateway Plugin registered for required gateway "stripe"/);
  });

  it('fails at boot when a registration is empty or has no gateway identifier', () => {
    expect(
      () => new GatewayManager([undefined as unknown as PaymentGateway]),
    ).toThrow(MissingGatewayError);
    expect(() => new GatewayManager([plugin('')])).toThrow(MissingGatewayError);
  });

  it('fails with a clear error when resolving an unregistered gateway', () => {
    const manager = new GatewayManager([plugin('vnpay')]);

    expect(() => manager.resolve('momo')).toThrow(UnknownGatewayError);
    expect(() => manager.resolve('momo')).toThrow(
      'No Gateway Plugin registered for gateway "momo" (registered: vnpay)',
    );
  });
});
