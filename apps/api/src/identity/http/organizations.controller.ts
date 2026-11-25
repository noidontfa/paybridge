import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/principal/access-policy.js';
import { INTERNAL_PREFIX } from '../../constants.js';
import { OrganizationRepository } from '../port/organization.repository.js';

/** Organizations, for the Super Admin's Organization switcher. */
@ApiTags('internal')
@RequirePermission('organizations:manage')
@Controller(`${INTERNAL_PREFIX}/organizations`)
export class OrganizationsController {
  constructor(
    @Inject(OrganizationRepository)
    private readonly organizations: OrganizationRepository,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List Organizations (Super Admin)' })
  @ApiOkResponse({ description: '`{ items: [{ id, name, status }] }`' })
  async list() {
    const items = await this.organizations.list();
    return {
      items: items.map(({ id, name, status }) => ({ id, name, status })),
    };
  }
}
