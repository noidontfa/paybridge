/** One transactional email carrying a single action link. */
export interface Email {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  /** The full URL the recipient follows (Invitation or Password Reset). */
  readonly link: string;
}

/**
 * Where Identity sends email. Invitations and Password Resets both use it.
 * Development and tests bind a console-log or recording adapter; a real
 * provider replaces only the adapter later.
 */
export abstract class EmailSender {
  abstract send(email: Email): Promise<void>;
}
