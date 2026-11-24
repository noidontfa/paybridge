import { HttpException } from '@nestjs/common';
import {
  DomainError,
  InvalidAmountError,
  PaymentNotFoundError,
} from '../domain/errors.js';
import { toHttp } from './domain-error.interceptor.js';

class UnmappedError extends DomainError {
  readonly code = 'NOT_IN_THE_TABLE';
}

describe('domain error -> HTTP mapping', () => {
  it('maps an input error to 400 with its message', () => {
    const mapped = toHttp(new InvalidAmountError('Amount must be > 0'));

    expect(mapped).toBeInstanceOf(HttpException);
    expect((mapped as HttpException).getStatus()).toBe(400);
    expect((mapped as HttpException).getResponse()).toEqual({
      message: 'Amount must be > 0',
      code: 'INVALID_AMOUNT',
    });
  });

  it('maps PaymentNotFound to 404', () => {
    expect(
      (toHttp(new PaymentNotFoundError('p1')) as HttpException).getStatus(),
    ).toBe(404);
  });

  it('leaves unmapped domain errors and other errors unchanged', () => {
    const unmapped = new UnmappedError('x');
    const plain = new Error('boom');

    expect(toHttp(unmapped)).toBe(unmapped);
    expect(toHttp(plain)).toBe(plain);
  });
});
