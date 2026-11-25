import 'server-only';
import pkg from '../../package.json';

export interface ConsoleEnvironment {
  apiBaseUrl: string;
  mockMode: boolean;
  version: string;
}

export const DEFAULT_API_BASE_URL = 'http://localhost:3000';

/**
 * Server-side configuration shown in Settings. Never import this from client
 * code: the API base URL must not reach the browser bundle (ADR 0004).
 */
export function getEnvironment(env: Record<string, string | undefined> = process.env): ConsoleEnvironment {
  return {
    apiBaseUrl: env.CONSOLE_API_BASE_URL || DEFAULT_API_BASE_URL,
    mockMode: env.CONSOLE_API_MOCKS === 'true',
    version: pkg.version,
  };
}
