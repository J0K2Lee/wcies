import { describe, expect, it } from 'vitest';
import {
  YANDEX_WEBHOOK_DEFAULT_ALLOWLIST,
  extractClientIp,
  isIpAllowed,
  isIpInCidr,
} from './yandex-webhook-ip';

/** Yandex webhook source-IP allowlist unit tests (docs/integrations/yandex.md §4). */

describe('isIpInCidr', () => {
  it('matches addresses inside each official range', () => {
    expect(isIpInCidr('5.45.207.10', '5.45.207.0/25')).toBe(true);
    expect(isIpInCidr('5.45.207.127', '5.45.207.0/25')).toBe(true);
    expect(isIpInCidr('141.8.142.3', '141.8.142.0/25')).toBe(true);
    expect(isIpInCidr('5.255.253.200', '5.255.253.0/25')).toBe(false);
    expect(isIpInCidr('5.255.253.126', '5.255.253.0/25')).toBe(true);
  });

  it('rejects addresses outside the range boundaries', () => {
    expect(isIpInCidr('5.45.207.128', '5.45.207.0/25')).toBe(false);
    expect(isIpInCidr('5.45.208.1', '5.45.207.0/25')).toBe(false);
    expect(isIpInCidr('8.8.8.8', '5.45.207.0/25')).toBe(false);
  });

  it('normalizes IPv6-mapped addresses', () => {
    expect(isIpInCidr('::ffff:5.45.207.5', '5.45.207.0/25')).toBe(true);
  });

  it('degrades on malformed input instead of throwing', () => {
    expect(isIpInCidr('not-an-ip', '5.45.207.0/25')).toBe(false);
    expect(isIpInCidr('5.45.207.5', 'garbage')).toBe(false);
    expect(isIpInCidr('5.45.207.5', '5.45.207.0/99')).toBe(false);
  });
});

describe('isIpAllowed', () => {
  it('accepts any official range and rejects others', () => {
    expect(isIpAllowed('5.45.207.1', YANDEX_WEBHOOK_DEFAULT_ALLOWLIST)).toBe(true);
    expect(isIpAllowed('141.8.142.64', YANDEX_WEBHOOK_DEFAULT_ALLOWLIST)).toBe(true);
    expect(isIpAllowed('5.255.253.2', YANDEX_WEBHOOK_DEFAULT_ALLOWLIST)).toBe(true);
    expect(isIpAllowed('203.0.113.9', YANDEX_WEBHOOK_DEFAULT_ALLOWLIST)).toBe(false);
  });
});

describe('extractClientIp', () => {
  it('prefers CF-Connecting-IP, then the first X-Forwarded-For hop, then the socket', () => {
    expect(
      extractClientIp({
        headers: { 'cf-connecting-ip': '5.45.207.7', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' },
        socket: { remoteAddress: '10.0.0.1' },
      }),
    ).toBe('5.45.207.7');
    expect(
      extractClientIp({ headers: { 'x-forwarded-for': '5.45.207.9, 10.0.0.2' }, socket: {} }),
    ).toBe('5.45.207.9');
    expect(extractClientIp({ headers: {}, socket: { remoteAddress: '5.45.207.11' } })).toBe(
      '5.45.207.11',
    );
    expect(extractClientIp({ headers: {}, socket: {} })).toBeNull();
  });

  it('tolerates array-valued headers', () => {
    expect(extractClientIp({ headers: { 'x-forwarded-for': ['5.45.207.8'] }, socket: {} })).toBe(
      '5.45.207.8',
    );
  });
});
