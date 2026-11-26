import { Injectable, Logger } from '@nestjs/common';
import { AlertSink, type Alert } from '../../domain/alert.js';

/** Default alert sink: writes one error log line per alert. */
@Injectable()
export class LoggerAlertSink extends AlertSink {
  private readonly logger = new Logger('Alert');

  raise(alert: Alert): void {
    this.logger.error(
      `[${alert.code}] ${alert.message} ${JSON.stringify(alert.details ?? {})}`,
    );
  }
}
