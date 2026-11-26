/** The time, replaceable in tests. */
export abstract class IdentityClock {
  abstract now(): Date;
}

export class SystemIdentityClock extends IdentityClock {
  now(): Date {
    return new Date();
  }
}
