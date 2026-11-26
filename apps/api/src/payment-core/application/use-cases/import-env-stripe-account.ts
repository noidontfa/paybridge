import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_ORGANIZATION_ID } from '../../../identity/domain/organization.js';
import { newId } from '../../domain/ids.js';
import { organizationScope } from '../../domain/organization-scope.js';
import { CredentialCipher } from '../../infrastructure/crypto/credential-cipher.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';

export interface EnvStripeAccount {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly publishableKey: string;
}

export type ImportEnvStripeResult = 'created' | 'exists' | 'not-configured';

/**
 * One-off migration step: copies the env-configured Stripe account into the
 * default Organization's Stripe Gateway Connection, encrypted. Never replaces
 * an existing connection.
 */
@Injectable()
export class ImportEnvStripeAccount {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(CredentialCipher) private readonly cipher: CredentialCipher,
  ) {}

  async execute(
    account: EnvStripeAccount | undefined,
  ): Promise<ImportEnvStripeResult> {
    if (!account) return 'not-configured';
    const repo = this.runner.repositories.gatewayConnections;
    const scope = organizationScope(DEFAULT_ORGANIZATION_ID);
    if (await repo.findByGateway(scope, 'stripe')) return 'exists';
    const sealed = this.cipher.encrypt(
      JSON.stringify({
        secretKey: account.secretKey,
        webhookSecret: account.webhookSecret,
        publishableKey: account.publishableKey,
      }),
    );
    await repo.create(scope, {
      id: newId(),
      gatewayId: 'stripe',
      credentialsCiphertext: sealed.ciphertext,
      credentialsKeyId: sealed.keyId,
    });
    return 'created';
  }
}
