import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import { GLOBAL_PREFIX, REQUEST_ID_HEADER } from '../constants.js';
import {
  type Env,
  isProduction,
  resolveLogLevel,
} from '../config/env.schema.js';

const HEALTH_PATH = new RegExp(`^/${GLOBAL_PREFIX}/health(/|\\?|$)`);

/**
 * Structured logging with pino.
 * - production: one JSON line per log (ready for Loki/ELK/Datadog)
 * - development: human friendly output through pino-pretty
 * Every request gets a correlation id (`x-request-id`, reused when sent by the
 * caller) that is attached to all logs of that request and echoed back.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const env = {
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
        };
        const prod = isProduction(env);

        return {
          pinoHttp: {
            level: resolveLogLevel(env),
            timestamp: stdTimeFunctions.isoTime,
            transport: prod
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    colorize: true,
                    translateTime: 'SYS:HH:MM:ss.l',
                    ignore: 'pid,hostname,req.headers,res.headers',
                  },
                },
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const incoming = req.headers[REQUEST_ID_HEADER];
              const id =
                (Array.isArray(incoming) ? incoming[0] : incoming) ||
                randomUUID();
              res.setHeader(REQUEST_ID_HEADER, id);
              return id;
            },
            // Never log credentials.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-api-key"]',
                'res.headers["set-cookie"]',
              ],
              censor: '[REDACTED]',
            },
            // Probes would drown out real traffic.
            autoLogging: {
              ignore: (req: IncomingMessage) => HEALTH_PATH.test(req.url ?? ''),
            },
            customLogLevel: (_req, res, err) => {
              if (err || res.statusCode >= 500) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },
          },
        };
      },
    }),
  ],
})
export class AppLoggerModule {}
