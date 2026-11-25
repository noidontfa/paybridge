import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type request from 'supertest';
import type { z } from 'zod';
import { AppModule } from '../../src/app.module.js';
import { applyGlobalPrefix } from '../../src/http-prefix.js';
import { apiErrorBodySchema } from '../contract/console/schemas.js';
import { createTestPrismaClient } from './test-prisma.js';
import { signedInHttp } from './users.js';

export interface ConsoleApp {
  app: INestApplication;
  get: (path: string) => Promise<request.Response>;
  /** POST a JSON body, signed in as the harness's Operator. */
  post: (path: string, body: object) => Promise<request.Response>;
  /** GET, expect 200, and parse the body with the Console's copied schema. */
  getValid: <S extends z.ZodType>(
    path: string,
    schema: S,
  ) => Promise<z.output<S>>;
  /** GET and expect 400 with the API's standard error envelope. */
  expectRejected: (path: string) => Promise<void>;
}

/**
 * Harness for the operator (`/internal`) read endpoints. Boots the real
 * AppModule in process and calls it over HTTP, signed in as an Operator. Use `getValid` for every
 * success so no response escapes the contract schemas.
 */
export async function createConsoleApp(): Promise<ConsoleApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
  await app.init();

  // Operator routes need a signed-in User: an Operator of the default
  // Organization, as the stub principal used to be.
  const prisma = createTestPrismaClient();
  const operator = await signedInHttp(app, prisma);
  await prisma.$disconnect();

  const get = (path: string) => operator.get(path);
  return {
    app,
    get,
    post: (path, body) => operator.post(path).send(body),
    async getValid(path, schema) {
      const res = await get(path);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return schema.parse(res.body);
    },
    async expectRejected(path) {
      const res = await get(path);
      expect(res.status, path).toBe(400);
      expect(apiErrorBodySchema.parse(res.body).statusCode).toBe(400);
    },
  };
}
