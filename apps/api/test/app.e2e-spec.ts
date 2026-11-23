import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { GLOBAL_PREFIX } from '../src/constants.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('PayBridge API (e2e)', () => {
  let app: INestApplication;
  const prisma = {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $queryRaw: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix(GLOBAL_PREFIX);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health -> 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/health/ready -> 200 when the database is reachable', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200);
    expect(res.body.checks.database).toBe('up');
  });

  it('GET /api/health/ready -> 503 envelope when the database is down', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(503);
    expect(res.body).toMatchObject({
      statusCode: 503,
      error: 'Service Unavailable',
      path: '/api/health/ready',
    });
  });

  it('unknown route -> 404 with the standard error envelope and request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/nope')
      .set('x-request-id', 'trace-123')
      .expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      method: 'GET',
      path: '/api/nope',
      requestId: 'trace-123',
    });
    expect(res.headers['x-request-id']).toBe('trace-123');
  });

  it('malformed JSON -> 400 with the standard envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/health')
      .set('content-type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(res.body.statusCode).toBe(400);
  });
});
