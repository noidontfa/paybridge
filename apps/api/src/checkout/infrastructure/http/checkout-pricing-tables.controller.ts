import {
  Controller,
  Get,
  Inject,
  Param,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CheckoutEndpoint,
  CurrentCheckout,
  type CheckoutCaller,
} from '../../../identity/port/index.js';
import { organizationScope } from '../../../payment-core/port/organization-scope.js';
import { ShowPricingTable } from '../../application/use-cases/pricing-tables.js';
import { CheckoutErrorInterceptor } from './checkout-error.interceptor.js';
import { CheckoutUnavailableFilter } from './checkout-unavailable.filter.js';

/**
 * The Pricing Table a host page shows, read by the SDK with a Publishable
 * Key from one of its allowed origins (ADR 0009). Anything that keeps it from
 * being shown answers 404 `CHECKOUT_UNAVAILABLE` with a developer reason.
 */
@ApiTags('checkout')
@CheckoutEndpoint()
@UseFilters(CheckoutUnavailableFilter)
@UseInterceptors(CheckoutErrorInterceptor)
@Controller('checkout/pricing-tables')
export class CheckoutPricingTablesController {
  constructor(@Inject(ShowPricingTable) private readonly show: ShowPricingTable) {}

  @Get(':id')
  @ApiOperation({ summary: 'A Pricing Table and its cards, for display' })
  async read(@CurrentCheckout() caller: CheckoutCaller, @Param('id') id: string) {
    const table = await this.show.execute(
      organizationScope(caller.organizationId),
      id,
    );
    return {
      id: table.id,
      mainColor: table.mainColor,
      theme: table.theme,
      language: table.language,
      buttonText: table.buttonText,
      plans: table.cards.map((card) => ({
        id: card.id,
        name: card.name,
        description: card.description,
        features: card.features,
        amount: card.amount,
        currency: card.currency,
        recommended: card.recommended,
        gateways: card.gatewayIds.map((id) => ({ id })),
        buyable: card.buyable,
        unavailableReason: card.unavailableReason,
      })),
    };
  }
}
