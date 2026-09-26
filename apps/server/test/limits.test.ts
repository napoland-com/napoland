import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { RollingLimit, clientIp } from '../src/limits';

/** Just the parts of a request that clientIp looks at. */
const req = (remoteAddress: string | undefined, forwardedFor?: string | string[]) =>
  ({ headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor }, socket: { remoteAddress } }) as unknown as IncomingMessage;

describe('clientIp', () => {
  it('uses the socket address and never reads X-Forwarded-For without trustProxy', () => {
    expect(clientIp(req('127.0.0.1', '203.0.113.7'), false)).toBe('127.0.0.1');
  });

  it('behind the proxy, takes the last X-Forwarded-For entry: the one the proxy added', () => {
    expect(clientIp(req('10.0.0.2', '203.0.113.7'), true)).toBe('203.0.113.7');
    expect(clientIp(req('10.0.0.2', '198.51.100.1,203.0.113.7'), true)).toBe('203.0.113.7');
    expect(clientIp(req('10.0.0.2', '198.51.100.1, 10.9.9.9 , 203.0.113.7 '), true)).toBe('203.0.113.7');
    expect(clientIp(req('10.0.0.2', ['198.51.100.1', '203.0.113.7']), true)).toBe('203.0.113.7');
    expect(clientIp(req('10.0.0.2', '2001:DB8::1'), true)).toBe('2001:db8::1');
  });

  it('falls back to the socket address when the header is missing or its last entry is empty', () => {
    expect(clientIp(req('10.0.0.2'), true)).toBe('10.0.0.2');
    expect(clientIp(req('10.0.0.2', ''), true)).toBe('10.0.0.2');
    expect(clientIp(req('10.0.0.2', '203.0.113.7, '), true)).toBe('10.0.0.2');
    expect(clientIp(req(undefined), false)).toBe('');
  });

  it('sees an IPv4 client of a dual-stack socket as plain IPv4', () => {
    expect(clientIp(req('::ffff:192.0.2.5'), false)).toBe('192.0.2.5');
    expect(clientIp(req('10.0.0.2', '::FFFF:192.0.2.5'), true)).toBe('192.0.2.5');
    expect(clientIp(req('::1'), false)).toBe('::1');
  });
});

describe('RollingLimit', () => {
  it('allows max successes per key in any window, and room again as they grow old', () => {
    let now = 0;
    const limit = new RollingLimit(2, 1000, () => now);
    const succeed = (key: string) => {
      expect(limit.start(key)).toBe(true);
      limit.finish(key, true);
    };
    succeed('a');
    now = 400;
    succeed('a');
    now = 999;
    expect(limit.start('a')).toBe(false);
    succeed('b'); // every key has its own places
    now = 1000; // the first success of 'a' is a whole window old
    succeed('a');
    expect(limit.start('a')).toBe(false);
    now = 1400;
    succeed('a');
  });

  it('only counts successes, but attempts hold a place while they run', () => {
    const limit = new RollingLimit(2, 1000, () => 0);
    expect(limit.start('a')).toBe(true);
    expect(limit.start('a')).toBe(true);
    expect(limit.start('a')).toBe(false);
    limit.finish('a', false);
    expect(limit.start('a')).toBe(true);
    limit.finish('a', true);
    limit.finish('a', true);
    expect(limit.start('a')).toBe(false);
  });

  it('forgets keys that do not come back, so it cannot grow forever', () => {
    let now = 0;
    const limit = new RollingLimit(5, 1000, () => now);
    for (let i = 0; i < 100; i++) {
      limit.start(`k${i}`);
      limit.finish(`k${i}`, true);
    }
    expect(limit.size).toBe(100);
    now = 999;
    limit.start('late');
    limit.finish('late', false);
    expect(limit.size).toBe(100);
    now = 1000;
    limit.start('late');
    limit.finish('late', false);
    expect(limit.size).toBe(0);
  });
});
