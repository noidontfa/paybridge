import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PasswordHasher } from '../../domain/services/password-hasher.js';

const argon2Async = promisify(argon2);

// OWASP's argon2id baseline: 19 MiB, 2 passes, 1 lane.
const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const TAG_LENGTH = 32;

function derive(
  password: string,
  salt: Buffer,
  memory: number,
  passes: number,
  parallelism: number,
): Promise<Buffer> {
  return argon2Async('argon2id', {
    message: password,
    nonce: salt,
    memory,
    passes,
    parallelism,
    tagLength: TAG_LENGTH,
  });
}

/** argon2id, stored as a PHC string (`$argon2id$v=19$m=..,t=..,p=..$salt$hash`). */
export class Argon2PasswordHasher extends PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const tag = await derive(password, salt, MEMORY_KIB, PASSES, PARALLELISM);
    return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${salt.toString('base64url')}$${tag.toString('base64url')}`;
  }

  async verify(password: string, hash: string): Promise<boolean> {
    const match =
      /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/.exec(
        hash,
      );
    if (!match) return false;
    const [, m, t, p, salt, expected] = match;
    const expectedTag = Buffer.from(expected!, 'base64url');
    const actual = await derive(
      password,
      Buffer.from(salt!, 'base64url'),
      Number(m),
      Number(t),
      Number(p),
    );
    return (
      actual.length === expectedTag.length && timingSafeEqual(actual, expectedTag)
    );
  }
}
