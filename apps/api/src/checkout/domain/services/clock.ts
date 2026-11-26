/** The time, replaceable in tests. */
export abstract class CheckoutClock {
  abstract now(): Date;
}

export class SystemCheckoutClock extends CheckoutClock {
  now(): Date {
    return new Date();
  }
}
