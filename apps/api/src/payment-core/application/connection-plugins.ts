import { Inject, Injectable } from '@nestjs/common';
import {
  GatewayDisabledError,
  GatewayNotConnectedError,
} from '../domain/errors.js';
import type { GatewayConnection } from '../domain/gateway-connection.js';
import { organizationScope } from '../domain/organization-scope.js';
import { GatewayManager } from '../gateway-manager/gateway-manager.js';
import { CredentialCipher } from '../infrastructure/crypto/credential-cipher.js';
import { TransactionRunner } from '../infrastructure/prisma/transaction-runner.js';
import type { PaymentGateway } from '../port/index.js';

/**
 * Finds the Gateway Plugin instance that acts for one Organization on one
 * gateway: built from that Organization's Gateway Connection, with its
 * decrypted credentials (ADR 0007).
 */
@Injectable()
export class ConnectionPlugins {
  constructor(
    @Inject(GatewayManager) private readonly gateways: GatewayManager,
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(CredentialCipher) private readonly cipher: CredentialCipher,
  ) {}

  /**
   * For a new PaymentTransaction: the Organization must hold an enabled
   * Gateway Connection for the gateway.
   */
  async forStart(
    organizationId: string,
    gatewayId: string,
  ): Promise<PaymentGateway> {
    const connection = await this.find(organizationId, gatewayId);
    if (!connection) throw new GatewayNotConnectedError(gatewayId);
    if (!connection.enabled) throw new GatewayDisabledError(gatewayId);
    return this.forConnection(connection);
  }

  /**
   * For everything after the start (re-queries, reconciliation, expiry,
   * cancels, Refunds): works on a disabled connection too. Falls back to the
   * deployment's own instance when the Organization has no connection (the
   * legacy env account).
   */
  async forExisting(
    organizationId: string,
    gatewayId: string,
  ): Promise<PaymentGateway> {
    const connection = await this.find(organizationId, gatewayId);
    return connection
      ? this.forConnection(connection)
      : this.gateways.resolve(gatewayId);
  }

  private find(
    organizationId: string,
    gatewayId: string,
  ): Promise<GatewayConnection | null> {
    return this.runner.repositories.gatewayConnections.findByGateway(
      organizationScope(organizationId),
      gatewayId,
    );
  }

  /** The instance acting for this connection, whether or not it is enabled. */
  forConnection(connection: GatewayConnection): PaymentGateway {
    const { credentialsCiphertext, credentialsKeyId } = connection;
    const credentials =
      credentialsCiphertext && credentialsKeyId
        ? (JSON.parse(
            this.cipher.decrypt({
              ciphertext: credentialsCiphertext,
              keyId: credentialsKeyId,
            }),
          ) as unknown)
        : null;
    return this.gateways.resolveForConnection(connection.gatewayId, {
      id: connection.id,
      credentialsVersion: connection.credentialsVersion,
      credentials,
    });
  }
}
