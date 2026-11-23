import {
  type ArgumentsHost,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '../../generated/prisma/client.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function setup() {
  const reply = vi.fn();
  const httpAdapterHost = {
    httpAdapter: {
      reply,
      getRequestUrl: () => '/api/test',
      getRequestMethod: () => 'POST',
    },
  } as unknown as HttpAdapterHost;
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req-1' }),
      getResponse: () => ({}),
    }),
  } as unknown as ArgumentsHost;
  const filter = new AllExceptionsFilter(httpAdapterHost);
  // Keep test output clean.
  vi.spyOn(filter['logger'], 'error').mockImplementation(() => {});
  vi.spyOn(filter['logger'], 'warn').mockImplementation(() => {});
  return { filter, host, reply };
}

describe('AllExceptionsFilter', () => {
  it('formats HttpException with a consistent envelope', () => {
    const { filter, host, reply } = setup();
    filter.catch(new ForbiddenException('nope'), host);

    const [, body, status] = reply.mock.calls[0];
    expect(status).toBe(403);
    expect(body).toMatchObject({
      statusCode: 403,
      error: 'Forbidden',
      message: 'nope',
      path: '/api/test',
      method: 'POST',
      requestId: 'req-1',
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('keeps array messages (validation errors)', () => {
    const { filter, host, reply } = setup();
    filter.catch(
      new BadRequestException(['a is required', 'b is invalid']),
      host,
    );
    expect(reply.mock.calls[0][1].message).toEqual([
      'a is required',
      'b is invalid',
    ]);
  });

  it('hides details of unexpected errors', () => {
    const { filter, host, reply } = setup();
    filter.catch(new Error('secret db password leaked'), host);

    const [, body, status] = reply.mock.calls[0];
    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it.each([
    ['P2002', 409],
    ['P2025', 404],
    ['P2003', 409],
  ])('maps Prisma %s to %i', (code, expected) => {
    const { filter, host, reply } = setup();
    const error = new Prisma.PrismaClientKnownRequestError('boom', {
      code,
      clientVersion: 'test',
    });
    filter.catch(error, host);
    expect(reply.mock.calls[0][2]).toBe(expected);
  });

  it('keeps the status of body-parser style errors', () => {
    const { filter, host, reply } = setup();
    filter.catch(
      Object.assign(new Error('Unexpected token'), { status: 400 }),
      host,
    );
    expect(reply.mock.calls[0][2]).toBe(400);
  });
});
