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

/** Unknown, expired, accepted or revoked Invitation link. */
export class InvalidInvitationTokenError extends Error {
  constructor() {
    super('This invitation link is invalid or has expired');
    this.name = 'InvalidInvitationTokenError';
  }
}

/** The Invitation does not exist for the caller, or is no longer open. */
export class InvitationNotFoundError extends Error {
  constructor() {
    super('Invitation not found');
    this.name = 'InvitationNotFoundError';
  }
}

/** The email already has a pending Invitation. */
export class InvitationPendingError extends Error {
  constructor(readonly email: string) {
    super(`${email} already has a pending Invitation`);
    this.name = 'InvitationPendingError';
  }
}

/** An Organization-scoped action needs one chosen Organization. */
export class OrganizationRequiredError extends Error {
  constructor() {
    super('Choose an Organization first');
    this.name = 'OrganizationRequiredError';
  }
}

/** The caller may not grant or manage this Role. */
export class InvitationRoleForbiddenError extends Error {
  constructor() {
    super('You may not manage Invitations for this Role');
    this.name = 'InvitationRoleForbiddenError';
  }
}

/** No User with this id in the Organization (another Organization's User looks the same). */
export class UserNotFoundError extends Error {
  constructor() {
    super('User not found');
    this.name = 'UserNotFoundError';
  }
}

/** An Organization must always keep one active Organization Admin. */
export class LastOrganizationAdminError extends Error {
  constructor() {
    super('The Organization must keep at least one active Organization Admin');
    this.name = 'LastOrganizationAdminError';
  }
}
