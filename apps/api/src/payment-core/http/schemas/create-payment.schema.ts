import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Body of `POST /payments`. Shape only: the amount, currency and expiry rules
 * are Core's and are checked by the use case, so they hold for every caller.
 */
export const createPaymentSchema = z.object({
  amount: z.string({ error: 'must be a decimal string such as "150000"' }),
  currency: z.string(),
  upstreamReference: z
    .string()
    .max(255)
    .refine((value) => value.trim() !== '', 'must not be empty'),
  expiresAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .optional(),
});

export type CreatePaymentBody = z.output<typeof createPaymentSchema>;

/** OpenAPI description of the body. Validation uses `createPaymentSchema`. */
export class CreatePaymentBodyDto {
  @ApiProperty({
    example: '150000',
    description: 'Decimal string in whole dong. Positive, no fraction digits.',
  })
  amount: string;

  @ApiProperty({ example: 'VND', description: 'Only VND in Phase 1.' })
  currency: string;

  @ApiProperty({
    example: 'order-2026-0001',
    description: 'Upstream Reference. Unique across PayBridge, immutable.',
    maxLength: 255,
  })
  upstreamReference: string;

  @ApiPropertyOptional({
    example: '2026-05-01T10:30:00.000Z',
    description:
      'Payment Expiry, ISO 8601. 30 minutes to 24 hours after creation; default 30 minutes.',
  })
  expiresAt?: string;
}
