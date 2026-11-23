import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ErrorResponseDto } from './common/filters/error-response.dto.js';

export const SWAGGER_PATH = 'docs';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('PayBridge API')
    .setDescription('PayBridge payment platform API')
    .setVersion('0.1.0')
    .build();

  // Built lazily on first request of /docs.
  SwaggerModule.setup(
    SWAGGER_PATH,
    app,
    () =>
      SwaggerModule.createDocument(app, config, {
        extraModels: [ErrorResponseDto],
      }),
    {
      jsonDocumentUrl: `${SWAGGER_PATH}/json`,
      swaggerOptions: { persistAuthorization: true },
    },
  );
}
