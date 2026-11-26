import { Controller, Get, UseFilters, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CheckoutEndpoint,
  CurrentCheckout,
  type CheckoutCaller,
} from '../../../identity/port/index.js';
import { CheckoutErrorInterceptor } from './checkout-error.interceptor.js';
import { CheckoutUnavailableFilter } from './checkout-unavailable.filter.js';

/**
 * Which websites may frame the checkout page (ticket 09). The checkout app
 * asks before serving the page, naming the host page it was opened for, and
 * sends the answer as `Content-Security-Policy: frame-ancestors`. A key that
 * may not be used there answers 422 `CHECKOUT_UNAVAILABLE`.
 */
@ApiTags('checkout')
@CheckoutEndpoint()
@UseFilters(CheckoutUnavailableFilter)
@UseInterceptors(CheckoutErrorInterceptor)
@Controller('checkout/frame')
export class CheckoutFrameController {
  @Get()
  @ApiOperation({
    summary: 'The origins allowed to frame the checkout page for this key',
  })
  read(@CurrentCheckout() caller: CheckoutCaller) {
    return { allowedOrigins: caller.allowedOrigins };
  }
}
