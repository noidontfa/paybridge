/**
 * One Organization's own account with one PaymentGateway (ADR 0007). The
 * stored credentials are encrypted; this record never carries them in clear.
 */
export interface GatewayConnection {
  readonly id: string;
  readonly organizationId: string;
  readonly gatewayId: string;
  readonly credentialsCiphertext: string | null;
  readonly credentialsKeyId: string | null;
  readonly credentialsVersion: number;
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
