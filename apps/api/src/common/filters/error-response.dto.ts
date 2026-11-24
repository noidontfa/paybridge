import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Shape of every error returned by the API. */
export class ErrorResponseDto {
  @ApiProperty({ example: 404 })
  statusCode!: number;

  @ApiProperty({ example: 'Not Found', description: 'HTTP status text' })
  error!: string;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Cannot GET /api/unknown',
  })
  message!: string | string[];

  @ApiPropertyOptional({
    description: 'Stable error code, for errors that have one',
    example: 'UPSTREAM_REFERENCE_EXISTS',
  })
  code?: string;

  @ApiPropertyOptional({
    description: 'Machine-readable fields of the error',
    type: 'object',
    additionalProperties: true,
    example: { paymentId: '01a20c09-3825-732f-aa60-5531dd0db7cd' },
  })
  details?: Record<string, unknown>;

  @ApiProperty({ example: '/api/unknown' })
  path!: string;

  @ApiProperty({ example: 'GET' })
  method!: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp!: string;

  @ApiPropertyOptional({
    description: 'Correlation id, same as the x-request-id response header',
    example: '6f1c1f54-6a53-4a58-8c4d-2d4d2b2b8a11',
  })
  requestId?: string;
}
