/**
 * Env files loaded by the ConfigModule, in priority order (first one wins).
 * Variables already present in the process environment always take precedence
 * over every file, which is what you want in containers / CI.
 *
 * Keep in sync with prisma.config.ts (the Prisma CLI loads the same files).
 */
export function getEnvFilePaths(
  nodeEnv: string = process.env.NODE_ENV ?? 'development',
): string[] {
  return [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env'];
}
