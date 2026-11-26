import type { ApiKeyRepository } from './api-key.repository.js';
import type { InvitationRepository } from './invitation.repository.js';
import type { OrganizationRepository } from './organization.repository.js';
import type { PasswordResetRepository } from './password-reset.repository.js';
import type { RefreshTokenRepository } from './refresh-token.repository.js';
import type { UserRepository } from './user.repository.js';

/** Every identity repository, bound to one database handle. */
export interface Repositories {
  readonly organizations: OrganizationRepository;
  readonly users: UserRepository;
  readonly refreshTokens: RefreshTokenRepository;
  readonly passwordResets: PasswordResetRepository;
  readonly invitations: InvitationRepository;
  readonly apiKeys: ApiKeyRepository;
}
