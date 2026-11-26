import { InvalidPricingPlanError } from '../errors.js';
import { definePricingPlanTerms } from './pricing-plan.js';

const plan = { name: 'Pro', amount: '199000' };

describe('Pricing Plan return URLs', () => {
  it('accept plain HTTP in development', () => {
    const terms = definePricingPlanTerms(
      { ...plan, successUrl: 'http://localhost:3000/thanks' },
      { allowInsecureUrls: true },
    );
    expect(terms.successUrl).toBe('http://localhost:3000/thanks');
  });

  it('require HTTPS outside development', () => {
    expect(() =>
      definePricingPlanTerms(
        { ...plan, successUrl: 'http://localhost:3000/thanks' },
        { allowInsecureUrls: false },
      ),
    ).toThrow(InvalidPricingPlanError);
  });

  it('never accept a non-web scheme, even in development', () => {
    expect(() =>
      definePricingPlanTerms(
        { ...plan, cancelUrl: 'javascript:alert(1)' },
        { allowInsecureUrls: true },
      ),
    ).toThrow(InvalidPricingPlanError);
  });

  it('treat a blank URL as none', () => {
    const terms = definePricingPlanTerms(
      { ...plan, successUrl: '  ', cancelUrl: null },
      { allowInsecureUrls: false },
    );
    expect(terms).toMatchObject({ successUrl: null, cancelUrl: null });
  });
});

describe('Pricing Plan Payment Expiry', () => {
  it('uses the same range as Payment Core: 30 minutes to 24 hours, default 30', () => {
    const rules = { allowInsecureUrls: false };
    expect(definePricingPlanTerms(plan, rules).expiryMinutes).toBe(30);
    expect(() =>
      definePricingPlanTerms({ ...plan, expiryMinutes: 29 }, rules),
    ).toThrow(InvalidPricingPlanError);
    expect(() =>
      definePricingPlanTerms({ ...plan, expiryMinutes: 24 * 60 + 1 }, rules),
    ).toThrow(InvalidPricingPlanError);
  });
});
