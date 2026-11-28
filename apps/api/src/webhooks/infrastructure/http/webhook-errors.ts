import { HttpStatus } from '@nestjs/common';
import { errorRule, type ErrorRule } from '../../../common/http/map-errors.js';
import {
  WebhookDeliveryBusyError,
  WebhookDeliveryNotFoundError,
} from '../../application/use-cases/webhook-deliveries.js';
import {
  InvalidWebhookUrlError,
  WebhookEndpointNotFoundError,
} from '../../domain/entities/webhook-endpoint.js';

/** How the webhooks module's errors are answered on its operator routes. */
export const WEBHOOK_ERROR_RULES: readonly ErrorRule[] = [
  errorRule({
    error: WebhookEndpointNotFoundError,
    status: HttpStatus.NOT_FOUND,
    code: 'WEBHOOK_ENDPOINT_NOT_FOUND',
  }),
  errorRule({
    error: InvalidWebhookUrlError,
    status: HttpStatus.BAD_REQUEST,
    code: 'INVALID_WEBHOOK_URL',
  }),
  errorRule({
    error: WebhookDeliveryNotFoundError,
    status: HttpStatus.NOT_FOUND,
    code: 'WEBHOOK_DELIVERY_NOT_FOUND',
  }),
  errorRule({
    error: WebhookDeliveryBusyError,
    status: HttpStatus.CONFLICT,
    code: 'WEBHOOK_DELIVERY_BUSY',
  }),
];
