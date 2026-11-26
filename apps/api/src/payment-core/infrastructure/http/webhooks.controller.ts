import {
  Controller,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  UnknownGatewayConnectionError,
  WebhookIntake,
  type CallbackTarget,
} from '../../application/webhook-intake.js';
import { DEFAULT_ORGANIZATION_ID, Public } from '../../../identity/port/index.js';
import { UnknownGatewayError } from '../../application/gateway-manager.js';
import type { CallbackAck, HeaderValues } from '../../port/index.js';

/**
 * Server-to-server callbacks from payment providers. The response is whatever
 * acknowledgement the Gateway Plugin defines, in the provider's format.
 */
@ApiTags('webhooks')
@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(@Inject(WebhookIntake) private readonly intake: WebhookIntake) {}

  @Post(':gatewayId/:connectionId')
  @ApiOperation({
    summary:
      'Receive a provider callback for one Gateway Connection (verified, stored, acknowledged)',
  })
  receiveForConnection(
    @Param('gatewayId') gatewayId: string,
    @Param('connectionId') connectionId: string,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    return this.handle({ connectionId }, gatewayId, req, res);
  }

  /**
   * Legacy route, kept until the Stripe dashboard points at the per-connection
   * URL: it forwards to the default Organization's Gateway Connection.
   */
  @Post(':gatewayId')
  @ApiOperation({
    summary: 'Legacy callback route (default Organization)',
    deprecated: true,
  })
  receive(
    @Param('gatewayId') gatewayId: string,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    return this.handle(
      { organizationId: DEFAULT_ORGANIZATION_ID },
      gatewayId,
      req,
      res,
    );
  }

  private async handle(
    target: CallbackTarget,
    gatewayId: string,
    req: RawBodyRequest<Request>,
    res: Response,
  ): Promise<void> {
    const rawBody = await readRawBody(req);
    let ack: CallbackAck;
    try {
      ack = await this.intake.receive(target, {
        gatewayId,
        rawBody,
        headers: req.headers,
        query: req.query as HeaderValues,
      });
    } catch (error) {
      if (
        error instanceof UnknownGatewayError ||
        error instanceof UnknownGatewayConnectionError
      ) {
        throw new NotFoundException(`Unknown gateway "${gatewayId}"`);
      }
      throw error;
    }
    send(res, ack);
  }
}

/**
 * The exact request bytes. JSON and form bodies are parsed by Nest, which keeps
 * the bytes in `req.rawBody` when the app is created with `rawBody: true`
 * (main.ts). Other content types are left unread, so read the stream here.
 */
async function readRawBody(req: RawBodyRequest<Request>): Promise<Uint8Array> {
  if (req.rawBody) return new Uint8Array(req.rawBody);
  if (!req.readable) {
    throw new InternalServerErrorException(
      'Webhook raw body unavailable: create the app with { rawBody: true }',
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  return new Uint8Array(Buffer.concat(chunks));
}

function send(res: Response, ack: CallbackAck): void {
  res.status(ack.httpStatus);
  if (ack.headers) res.set(ack.headers);
  if (typeof ack.body === 'string' || Buffer.isBuffer(ack.body)) {
    res.send(ack.body);
  } else if (ack.body === undefined) {
    res.end();
  } else {
    res.json(ack.body);
  }
}
