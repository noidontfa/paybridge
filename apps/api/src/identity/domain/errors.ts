/** Unknown email or wrong password: one error, so neither is revealed. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid email or password');
    this.name = 'InvalidCredentialsError';
  }
}

/** The password was right but the User is deactivated. */
export class UserDeactivatedError extends Error {
  constructor() {
    super('This account is deactivated');
    this.name = 'UserDeactivatedError';
  }
}

export class OrganizationSuspendedError extends Error {
  constructor() {
    super('Your Organization is suspended');
    this.name = 'OrganizationSuspendedError';
  }
}

/** Unknown, expired, revoked or already used refresh token. */
export class InvalidRefreshTokenError extends Error {
  constructor() {
    super('The refresh token is not valid');
    this.name = 'InvalidRefreshTokenError';
  }
}

export class EmailTakenError extends Error {
  constructor(readonly email: string) {
    super(`A User with email ${email} already exists`);
    this.name = 'EmailTakenError';
  }
}

/** Unknown, expired, already used or voided Password Reset link. */
export class InvalidResetTokenError extends Error {
  constructor() {
    super('This password reset link is invalid or has expired');
    this.name = 'InvalidResetTokenError';
  }
}

/** Changing a password needs the current one; it did not match. */
export class InvalidCurrentPasswordError extends Error {
  constructor() {
    super('The current password is not right');
    this.name = 'InvalidCurrentPasswordError';
  }
}
