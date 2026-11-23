import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getEnvFilePaths } from './env-files.js';
import { envSchema } from './env.schema.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: getEnvFilePaths(),
      // The app refuses to boot if the environment is invalid.
      validationSchema: envSchema,
    }),
  ],
})
export class AppConfigModule {}
