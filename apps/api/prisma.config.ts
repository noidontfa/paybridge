import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Same precedence as the Nest ConfigModule (see src/config/env-files.ts):
// real environment variables win, then the first existing file in this list.
const nodeEnv = process.env.NODE_ENV ?? 'development';
config({
  path: [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env'],
  quiet: true,
});

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
