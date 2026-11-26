/**
 * Deployment-dependent rules for Publishable Keys. `localhost` origins are
 * accepted only outside production.
 */
export class PublishableKeyRules {
  constructor(readonly allowLocalhost: boolean) {}
}
