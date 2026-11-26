import { z } from 'zod';
import { isIsoTime, keysetCursor } from './keyset-cursor.js';

interface Row {
  readonly id: string;
  readonly at: Date;
}

const ID_A = '0b6a1a8e-4f0e-4d8a-9d1c-1a2b3c4d5e6f';
const ID_B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const rowA: Row = { id: ID_A, at: new Date('2026-05-01T10:00:00.000Z') };
const rowB: Row = { id: ID_B, at: new Date('2026-05-01T09:00:00.000Z') };

const cursor = keysetCursor<Row>({
  tag: 'things',
  valueOf: (row) => row.at.toISOString(),
  isValue: isIsoTime,
});

/** Runs `parse` through a schema, as the list query schemas do. */
function parse(
  codec: typeof cursor,
  value: string | undefined,
) {
  return z
    .object({ cursor: z.string().optional() })
    .transform((q, ctx) => {
      const after = codec.parse(ctx, q.cursor);
      return after === null ? z.NEVER : { after };
    })
    .safeParse({ cursor: value });
}

const encode = (parts: unknown) =>
  Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');

describe('keysetCursor', () => {
  it('has no next cursor when the rows fit in the page', () => {
    expect(cursor.page([rowA, rowB], 2)).toEqual({
      items: [rowA, rowB],
      nextCursor: null,
    });
  });

  it('drops the extra row and builds the cursor from the last row shown', () => {
    const page = cursor.page([rowA, rowB], 1);
    expect(page.items).toEqual([rowA]);
    expect(page.nextCursor).toBe(
      encode(['things', '2026-05-01T10:00:00.000Z', ID_A]),
    );
  });

  it('reads back the cursor it made', () => {
    const { nextCursor } = cursor.page([rowA, rowB], 1);
    const result = parse(cursor, nextCursor!);
    expect(result.success && result.data.after).toEqual({
      value: '2026-05-01T10:00:00.000Z',
      id: ID_A,
    });
  });

  it('treats no cursor as the first page', () => {
    const result = parse(cursor, undefined);
    expect(result.success && result.data.after).toBeUndefined();
  });

  it('rejects a cursor made for another list or ordering', () => {
    const other = keysetCursor<Row>({
      tag: 'other',
      valueOf: (row) => row.at.toISOString(),
      isValue: isIsoTime,
      invalidMessage: 'is not valid for this list and order',
    });
    const { nextCursor } = cursor.page([rowA, rowB], 1);
    const result = parse(other, nextCursor!);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['cursor'],
        message: 'is not valid for this list and order',
      }),
    ]);
  });

  it.each([
    ['not base64url', 'not a cursor!'],
    ['not JSON', Buffer.from('nope').toString('base64url')],
    ['the wrong number of parts', encode(['things', ID_A])],
    ['a value this list does not sort by', encode(['things', 'yesterday', ID_A])],
    ['an id that is not a UUID', encode(['things', '2026-05-01T10:00:00.000Z', '42'])],
  ])('rejects a cursor with %s', (_, value) => {
    const result = parse(cursor, value);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['cursor'],
      message: 'is not valid for this list',
    });
  });
});
