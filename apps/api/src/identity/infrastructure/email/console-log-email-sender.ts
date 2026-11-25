import { Injectable, Logger } from '@nestjs/common';
import { type Email, EmailSender } from '../../port/email-sender.js';

/** Development adapter: writes the email to the log so the link can be copied. */
@Injectable()
export class ConsoleLogEmailSender extends EmailSender {
  private readonly logger = new Logger('Email');

  send(email: Email): Promise<void> {
    this.logger.log(
      `to=${email.to} subject="${email.subject}" link=${email.link}`,
    );
    return Promise.resolve();
  }
}
