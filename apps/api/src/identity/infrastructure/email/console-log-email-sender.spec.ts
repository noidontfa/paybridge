import { Logger } from '@nestjs/common';
import { ConsoleLogEmailSender } from './console-log-email-sender.js';
import { RecordingEmailSender } from './recording-email-sender.js';

const email = {
  to: 'ada@example.com',
  subject: 'You are invited to Acme',
  body: 'Welcome. Use the link below to set your password.',
  link: 'http://localhost:8888/invitations/accept?token=abc123',
};

describe('ConsoleLogEmailSender', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs recipient, subject and the full link in one entry', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    await new ConsoleLogEmailSender().send(email);

    expect(log).toHaveBeenCalledTimes(1);
    const entry = String(log.mock.calls[0]?.[0]);
    expect(entry).toContain('ada@example.com');
    expect(entry).toContain('You are invited to Acme');
    expect(entry).toContain(
      'http://localhost:8888/invitations/accept?token=abc123',
    );
  });
});

describe('RecordingEmailSender', () => {
  it('exposes the emails it received, in order', async () => {
    const sender = new RecordingEmailSender();
    await sender.send(email);
    await sender.send({ ...email, to: 'bob@example.com' });

    expect(sender.sent.map((e) => e.to)).toEqual([
      'ada@example.com',
      'bob@example.com',
    ]);
    expect(sender.sent[0]?.link).toBe(email.link);
  });
});
