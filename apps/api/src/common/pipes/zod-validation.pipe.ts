import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates a request value with a zod schema and returns the parsed value.
 * On failure it throws 400 with one message per issue (`path: message`).
 *
 * Usage: `@Body(new ZodValidationPipe(schema)) body: z.output<typeof schema>`.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<T>
> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        result.error.issues.map((issue) =>
          issue.path.length > 0
            ? `${issue.path.join('.')}: ${issue.message}`
            : issue.message,
        ),
      );
    }
    return result.data;
  }
}
