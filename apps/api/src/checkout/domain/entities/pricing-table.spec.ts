import { InvalidPricingTableError } from '../errors.js';
import { definePricingTable, type PricingTableInput } from './pricing-table.js';

const BASIC = '0190a000-0000-7000-8000-000000000001';
const PRO = '0190a000-0000-7000-8000-000000000002';
const TEAM = '0190a000-0000-7000-8000-000000000003';
const MORE = '0190a000-0000-7000-8000-000000000004';

const table: PricingTableInput = {
  name: 'Home page',
  planIds: [BASIC, PRO, TEAM],
  recommendedPlanId: PRO,
  mainColor: '#4F46E5',
  theme: 'light',
  language: 'vi',
  buttonText: 'Mua ngay',
};

function fieldOf(input: PricingTableInput): string | undefined {
  try {
    definePricingTable(input);
    return undefined;
  } catch (error) {
    if (error instanceof InvalidPricingTableError) return error.field;
    throw error;
  }
}

describe('Pricing Table plans', () => {
  it('keeps one to three Pricing Plans in the order given', () => {
    expect(
      definePricingTable({ ...table, planIds: [TEAM, PRO, BASIC] }).planIds,
    ).toEqual([TEAM, PRO, BASIC]);
    expect(
      definePricingTable({ ...table, planIds: [PRO], recommendedPlanId: null })
        .planIds,
    ).toEqual([PRO]);
  });

  it('refuses no Pricing Plan at all', () => {
    expect(fieldOf({ ...table, planIds: [], recommendedPlanId: null })).toBe(
      'planIds',
    );
  });

  it('refuses a fourth Pricing Plan', () => {
    expect(fieldOf({ ...table, planIds: [BASIC, PRO, TEAM, MORE] })).toBe(
      'planIds',
    );
  });

  it('refuses the same Pricing Plan twice', () => {
    expect(fieldOf({ ...table, planIds: [PRO, PRO] })).toBe('planIds');
  });
});

describe('the recommended Pricing Plan', () => {
  it('is optional', () => {
    expect(
      definePricingTable({ ...table, recommendedPlanId: undefined })
        .recommendedPlanId,
    ).toBeNull();
  });

  it('must be one of the Pricing Table’s Pricing Plans', () => {
    expect(definePricingTable(table).recommendedPlanId).toBe(PRO);
    expect(fieldOf({ ...table, planIds: [BASIC, TEAM] })).toBe(
      'recommendedPlanId',
    );
  });
});

describe('the look', () => {
  it('normalises the main colour to lower-case #rrggbb', () => {
    expect(definePricingTable(table).mainColor).toBe('#4f46e5');
  });

  it.each([
    ['a named colour', { mainColor: 'red' }, 'mainColor'],
    ['a short hex colour', { mainColor: '#fff' }, 'mainColor'],
    ['CSS in the colour', { mainColor: '#000000; background:url(x)' }, 'mainColor'],
    ['an empty name', { name: ' ' }, 'name'],
    ['empty button text', { buttonText: '' }, 'buttonText'],
    ['overlong button text', { buttonText: 'x'.repeat(41) }, 'buttonText'],
    ['multi-line button text', { buttonText: 'Buy\nnow' }, 'buttonText'],
  ])('refuses %s', (_case, change, field) => {
    expect(fieldOf({ ...table, ...change })).toBe(field);
  });

  it('trims the name and button text', () => {
    expect(
      definePricingTable({ ...table, name: ' Home ', buttonText: ' Buy ' }),
    ).toMatchObject({ name: 'Home', buttonText: 'Buy' });
  });
});
