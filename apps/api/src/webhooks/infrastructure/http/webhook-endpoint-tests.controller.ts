import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireSensitivePermission } from '../../../common/principal/access-policy.js';
import { INTERNAL_PREFIX } from '../../../constants.js';
import {
  ReadWebhookDeliveries,
  SendWebhooksByHand,
} from '../../application/use-cases/webhook-deliveries.js';
import { MapErrors } from '../../../common/http/map-errors.js';
import { callerOf } from '../../../common/principal/caller.js';
import { WEBHOOK_ERROR_RULES } from './webhook-errors.js';
import { detailView } from './webhook-deliveries.controller.js';

/**
 * Test sends: an Organization Admin checks a receiver with a `webhook.test`
 * event. Managing endpoints is the Admin's job, so an Operator is refused.
 */
@ApiTags('internal')
@RequireSensitivePermission('webhook-endpoints:manage')
@MapErrors(WEBHOOK_ERROR_RULES)
@Controller(`${INTERNAL_PREFIX}/webhook-endpoints`)
export class WebhookEndpointTestsController {
  constructor(
    @Inject(SendWebhooksByHand) private readonly send: SendWebhooksByHand,
    @Inject(ReadWebhookDeliveries)
    private readonly deliveries: ReadWebhookDeliveries,
  ) {}

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send a webhook.test event to one endpoint now and answer with the test delivery',
  })
  async test(
    @Req() request: Record<string, unknown>,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const { scope, actor } = callerOf(request);
    const deliveryId = await this.send.sendTest(scope, id, actor);
    return detailView(await this.deliveries.get(scope, deliveryId));
  }
}
