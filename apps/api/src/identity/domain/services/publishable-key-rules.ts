/**
 * Deployment-dependent rules for Publishable Keys. `localhost` origins are
 * accepted only outside production. `checkoutAppOrigins` are where the
 * checkout app is served: its iframe page calls the checkout endpoints from
 * there, naming the host page it is embedded in (ticket 09).
 */
export class PublishableKeyRules {
  constructor(
    readonly allowLocalhost: boolean,
    readonly checkoutAppOrigins: readonly string[] = [],
  ) {}
}
