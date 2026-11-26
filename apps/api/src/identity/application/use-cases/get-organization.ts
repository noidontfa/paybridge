import { Inject, Injectable } from '@nestjs/common';
import {
  OrganizationNotFoundError,
  type Organization,
} from '../../domain/entities/organization.js';
import { OrganizationRepository } from '../../domain/repositories/organization.repository.js';

/** Looks an Organization up by id; unknown id: `OrganizationNotFoundError`. */
@Injectable()
export class GetOrganization {
  constructor(
    @Inject(OrganizationRepository)
    private readonly organizations: OrganizationRepository,
  ) {}

  async execute(id: string): Promise<Organization> {
    const organization = await this.organizations.findById(id);
    if (!organization) throw new OrganizationNotFoundError(id);
    return organization;
  }
}
