import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const pipe = new ZodValidationPipe(
  z.object({ name: z.string().min(1), when: z.iso.datetime().optional() }),
);

describe('ZodValidationPipe', () => {
  it('returns the parsed value', () => {
    expect(pipe.transform({ name: 'a', extra: 1 })).toEqual({ name: 'a' });
  });

  it('throws 400 with one "path: message" per issue', () => {
    let error: unknown;
    try {
      pipe.transform({ name: '', when: 'soon' });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(BadRequestException);
    const { message } = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    expect(message).toHaveLength(2);
    expect(message[0]).toMatch(/^name: /);
    expect(message[1]).toMatch(/^when: /);
  });

  it('reports a non-object body without a path', () => {
    expect(() => pipe.transform('nope')).toThrow(BadRequestException);
  });
});
