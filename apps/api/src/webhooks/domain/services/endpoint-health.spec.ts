import { FAILING_STREAK, isFailing } from './endpoint-health.js';

describe('a Webhook Endpoint is failing', () => {
  it('when its latest attempts all failed', () => {
    expect(isFailing([false, false, false])).toBe(true);
  });

  it('not when the latest attempt succeeded', () => {
    expect(isFailing([true, false, false, false])).toBe(false);
  });

  it('not when an attempt among the latest three succeeded', () => {
    expect(isFailing([false, false, true])).toBe(false);
  });

  it('not while it has had too few attempts to tell', () => {
    expect(isFailing([false, false])).toBe(false);
    expect(isFailing([])).toBe(false);
  });

  it('looks at the latest three attempts', () => {
    expect(FAILING_STREAK).toBe(3);
  });
});
