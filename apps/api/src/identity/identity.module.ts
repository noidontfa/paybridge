import { Module } from '@nestjs/common';
import { ConsoleLogEmailSender } from './infrastructure/email/console-log-email-sender.js';
import { EmailSender } from './port/email-sender.js';

/**
 * Identity: Organizations, Users, Invitations, Password Resets, sign-in and
 * API Keys (`iam_` tables). Later tickets register the rest here.
 */
@Module({
  providers: [{ provide: EmailSender, useClass: ConsoleLogEmailSender }],
  exports: [EmailSender],
})
export class IdentityModule {}
