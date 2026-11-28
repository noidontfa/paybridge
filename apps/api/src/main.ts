import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { applyGlobalPrefix } from './http-prefix.js';
import {
  type Env,
  resolveSwaggerEnabled,
  resolveTrustProxy,
} from './config/env.schema.js';
import { SWAGGER_PATH, setupSwagger } from './swagger.js';

async function bootstrap() {
  // bufferLogs: hold bootstrap logs until pino is attached, so nothing is lost.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Keep the exact request bytes (req.rawBody) for webhook signature checks.
    rawBody: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });
  const nodeEnv = config.get('NODE_ENV', { infer: true });

  app.disable('x-powered-by');
  const trustProxy = resolveTrustProxy(config.get('TRUST_PROXY', { infer: true }));
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
  applyGlobalPrefix(app);
  app.enableShutdownHooks(); // graceful SIGTERM/SIGINT: closes Prisma pool

  const swaggerEnabled = resolveSwaggerEnabled({
    NODE_ENV: nodeEnv,
    SWAGGER_ENABLED: config.get('SWAGGER_ENABLED', { infer: true }),
  });
  if (swaggerEnabled) setupSwagger(app);

  // Crash loudly (and let the orchestrator restart us) on truly unexpected failures.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });

  await app.listen(port);
  logger.log(`PayBridge API (${nodeEnv}) listening on port ${port}`);
  if (swaggerEnabled) {
    logger.log(`Swagger UI available at /${SWAGGER_PATH}`);
  }
}

await bootstrap();
