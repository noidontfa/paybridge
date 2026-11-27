import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  RequirePermission,
  RequireSensitivePermission,
} from '../../../common/principal/access-policy.js';
import { actorLabel } from '../../../common/principal/actor.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { INTERNAL_PREFIX } from '../../../constants.js';
import type { OrganizationScope } from '../../../payment-core/port/organization-scope.js';
import { ManagePricingTables } from '../../application/use-cases/pricing-tables.js';
import type { Actor } from '../../domain/entities/pricing-plan.js';
import {
  PRICING_TABLE_LANGUAGES,
  PRICING_TABLE_THEMES,
  type PricingTable,
} from '../../domain/entities/pricing-table.js';
import { CheckoutErrorInterceptor } from './checkout-error.interceptor.js';
import {
  CurrentActor,
  CurrentScope,
} from '../../../common/principal/caller.js';

// Shapes only; the Pricing Table rules (plan count, recommended plan, colour,
// button text) are checked by the domain so every caller gets the same answers.
const tableSchema = z.object({
  name: z.string(),
  planIds: z.array(z.uuid()).max(10),
  recommendedPlanId: z.uuid().nullable().optional(),
  mainColor: z.string(),
  theme: z.enum(PRICING_TABLE_THEMES),
  language: z.enum(PRICING_TABLE_LANGUAGES),
  buttonText: z.string(),
});
type TableBody = z.output<typeof tableSchema>;

const view = (table: PricingTable) => ({
  id: table.id,
  name: table.name,
  planIds: table.planIds,
  recommendedPlanId: table.recommendedPlanId,
  mainColor: table.mainColor,
  theme: table.theme,
  language: table.language,
  buttonText: table.buttonText,
  updatedBy: {
    userId: table.updatedBy.userId,
    role: table.updatedBy.role,
    name: table.updatedBy.name,
    label: actorLabel(table.updatedBy),
  },
  createdAt: table.createdAt,
  updatedAt: table.updatedAt,
});

/**
 * Pricing Table management. Operators may read; every write is sensitive
 * (re-checked in the database, ADR 0008) and needs `pricing:manage`. Edits
 * are POSTs, so the Console's BFF needs no new methods.
 */
@ApiTags('internal')
@UseInterceptors(CheckoutErrorInterceptor)
@Controller(`${INTERNAL_PREFIX}/pricing-tables`)
export class PricingTablesController {
  constructor(
    @Inject(ManagePricingTables) private readonly tables: ManagePricingTables,
  ) {}

  @Get()
  @RequirePermission('pricing:view')
  @ApiOperation({ summary: "List the Organization's Pricing Tables" })
  async list(@CurrentScope() scope: OrganizationScope) {
    const items = await this.tables.list(scope);
    return { items: items.map(view) };
  }

  @Get(':id')
  @RequirePermission('pricing:view')
  @ApiOperation({ summary: 'One Pricing Table' })
  async get(
    @CurrentScope() scope: OrganizationScope,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return view(await this.tables.get(scope, id));
  }

  @Post()
  @RequireSensitivePermission('pricing:manage')
  @ApiOperation({ summary: 'Create a Pricing Table' })
  async create(
    @CurrentScope() scope: OrganizationScope,
    @CurrentActor() editor: Actor,
    @Body(new ZodValidationPipe(tableSchema)) body: TableBody,
  ) {
    return view(await this.tables.create(scope, body, editor));
  }

  @Post(':id')
  @HttpCode(HttpStatus.OK)
  @RequireSensitivePermission('pricing:manage')
  @ApiOperation({ summary: 'Replace every field of a Pricing Table' })
  async update(
    @CurrentScope() scope: OrganizationScope,
    @CurrentActor() editor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(tableSchema)) body: TableBody,
  ) {
    return view(await this.tables.update(scope, id, body, editor));
  }

  @Delete(':id')
  @RequireSensitivePermission('pricing:manage')
  @ApiOperation({
    summary: 'Delete a Pricing Table; pages embedding it show unavailable',
  })
  async delete(
    @CurrentScope() scope: OrganizationScope,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.tables.delete(scope, id);
    return { deleted: true };
  }
}
