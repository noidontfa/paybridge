import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Body of `POST /payments/:id/attempts`. Shape only: whether the gateway
 * exists and the Payment accepts an attempt is Core's decision.
 */
export const startAttemptSchema = z.object({
  gatewayId: z.string().trim().min(1).max(64),
  returnUrl: z.url({ protocol: /^https?$/ }).max(2048),
  description: z.string().trim().min(1).max(255).optional(),
});

export type StartAttemptBody = z.output<typeof startAttemptSchema>;

/** OpenAPI description of the body. Validation uses `startAttemptSchema`. */
export class StartAttemptBodyDto {
  @ApiProperty({
    example: 'vnpay',
    description: 'Identifier of the gateway the customer chose.',
  })
  gatewayId: string;

  @ApiProperty({
    example: 'https://shop.example/orders/2026-0001/return',
    description: "Where the gateway sends the customer's browser back to.",
  })
  returnUrl: string;

  @ApiPropertyOptional({
    example: 'Order 2026-0001',
    description:
      'Shown to the customer by the gateway. Default: "Payment <upstream reference>".',
    maxLength: 255,
  })
  description?: string;
}
