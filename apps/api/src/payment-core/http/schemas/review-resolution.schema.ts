import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Body of `POST /internal/payments/:id/review-resolution`. Shape only: the
 * review rules (72 hours, amount, reason) are Core's decision.
 */
export const reviewResolutionSchema = z.object({
  attemptId: z.uuid(),
  note: z.string().trim().min(1).max(2000),
  status: z.enum(['SUCCEEDED', 'FAILED']).optional(),
  amount: z.string().trim().min(1).max(40).optional(),
});

export type ReviewResolutionBody = z.output<typeof reviewResolutionSchema>;

/** OpenAPI description of the body. Validation uses `reviewResolutionSchema`. */
export class ReviewResolutionBodyDto {
  @ApiProperty({ format: 'uuid', description: 'The attempt in review' })
  attemptId: string;

  @ApiProperty({
    description: 'Mandatory explanation, kept in the audit trail',
  })
  note: string;

  @ApiPropertyOptional({
    enum: ['SUCCEEDED', 'FAILED'],
    description:
      'Omit to only add a note (the only option for LATE_SUCCESS_ON_CLOSED_PAYMENT and DUPLICATE_SUCCESS).',
  })
  status?: 'SUCCEEDED' | 'FAILED';

  @ApiPropertyOptional({
    example: '150000',
    description:
      'Amount the provider collected, as the operator confirmed it. Required for SUCCEEDED and must equal the Payment amount.',
  })
  amount?: string;
}
