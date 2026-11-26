import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema.js';
import { newIdentityId } from '../../domain/ids.js';
import { PASSWORD_RESET_TTL_MS } from '../../domain/password-reset.js';
import { normalizeEmail } from '../../domain/user.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { IdentityClock } from '../../port/clock.js';
import { EmailSender } from '../../port/email-sender.js';

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Emails a Password Reset link to a known, active User. It returns the same
 * way for every address: the caller cannot tell whether one is a User. A new
 * request voids the User's earlier links.
 */
@Injectable()
export class RequestPasswordReset {
  constructor(
    @Inject(TransactionRunner) private readonly runner: TransactionRunner,
    @Inject(EmailSender) private readonly email: EmailSender,
    @Inject(IdentityClock) private readonly clock: IdentityClock,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  async execute(email: string): Promise<void> {
    const user = await this.runner.repositories.users.findByEmail(
      normalizeEmail(email),
    );
    if (!user?.active) return;

    const now = this.clock.now();
    const token = randomBytes(32).toString('base64url');
    await this.runner.run(async (repos) => {
      await repos.passwordResets.voidUnusedOfUser(user.id, now);
      await repos.passwordResets.create({
        id: newIdentityId(),
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
      });
    });

    const base = this.config
      .get('CONSOLE_BASE_URL', { infer: true })
      .replace(/\/$/, '');
    await this.email.send({
      to: user.email,
      subject: 'Reset your PayBridge password',
      body: 'Use the link to choose a new password. It works once and expires in 30 minutes. If you did not ask for it, ignore this email.',
      link: `${base}/reset-password?token=${encodeURIComponent(token)}`,
    });
  }
}
