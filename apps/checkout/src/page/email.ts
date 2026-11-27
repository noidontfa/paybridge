// The email a Customer types when the snippet asks for one (`data-ask-email`).
// The same rule as the API's (zod's `email()`, at most 254 characters), so a
// typo is caught here, before a Payment is started with it.

const EMAIL =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
const MAX_LENGTH = 254;

/** The email, trimmed and lower-cased, or null when it is not an email. */
export function readEmail(typed: string): string | null {
  const email = typed.trim().toLowerCase();
  return email.length <= MAX_LENGTH && EMAIL.test(email) ? email : null;
}
