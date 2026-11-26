import { Injectable } from '@nestjs/common';
import { type Email, EmailSender } from '../../port/email-sender.js';

/** Test adapter: keeps every email it receives. Swap in with overrideProvider. */
@Injectable()
export class RecordingEmailSender extends EmailSender {
  readonly sent: Email[] = [];

  send(email: Email): Promise<void> {
    this.sent.push(email);
    return Promise.resolve();
  }
}
