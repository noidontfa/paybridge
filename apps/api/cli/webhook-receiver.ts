import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { SEED_WEBHOOK_ENDPOINT } from '../seed/seed.js';

// `pnpm webhooks:receive [-- --port 9998] [-- --secret whsec_pb_…]`
// A local Webhook receiver for development: the seeded Webhook Endpoint points
// here. It checks each delivery's signature the way an Organization's system
// should (HMAC-SHA256 of `<t>.<raw body>`, timestamp no older than five
// minutes) and prints the Payment Event. Answers 200, or 400 on a bad
// signature.

const TOLERANCE_S = 5 * 60;

function verify(secret: string, header: string, body: string): string | null {
  const parts = header.split(',');
  const t = parts.find((p) => p.startsWith('t='))?.slice(2);
  if (!t || !/^\d+$/.test(t)) return 'no timestamp';
  if (Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCE_S) {
    return 'timestamp too old';
  }
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest();
  const match = parts
    .filter((p) => p.startsWith('v1='))
    .some((p) => {
      const given = Buffer.from(p.slice(3), 'hex');
      return (
        given.length === expected.length && timingSafeEqual(given, expected)
      );
    });
  return match ? null : 'no signature matches';
}

function main(): void {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '9998' },
      secret: { type: 'string', default: SEED_WEBHOOK_ENDPOINT.secret },
    },
  });
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const problem = verify(
        values.secret,
        String(req.headers['paybridge-signature'] ?? ''),
        body,
      );
      if (problem) {
        console.log(`${req.method} ${req.url}: REFUSED (${problem})`);
        res.statusCode = 400;
        res.end(problem);
        return;
      }
      const event = JSON.parse(body) as { id: string; type: string };
      console.log(
        `${event.type} ${event.id}\n${JSON.stringify(event, null, 2)}`,
      );
      res.end('ok');
    });
  });
  server.listen(Number(values.port), () => {
    console.log(`Receiving Webhooks on http://localhost:${values.port}/`);
  });
}

main();
