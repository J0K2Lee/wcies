/**
 * Yandex Market webhook source-IP allowlist (docs/integrations/yandex.md §4).
 *
 * Yandex signs NOTHING on its notifications - the official recommendation is
 * to restrict the callback endpoint to the platform's source ranges:
 *   5.45.207.0/25, 141.8.142.0/25, 5.255.253.0/25
 * IPv4 only (all ranges are v4); IPv6-mapped addresses are normalized.
 */

/** Official Yandex Market notification source ranges (verified 2026-09-18). */
export const YANDEX_WEBHOOK_DEFAULT_ALLOWLIST = [
  '5.45.207.0/25',
  '141.8.142.0/25',
  '5.255.253.0/25',
] as const;

/** Parses "a.b.c.d" into a 32-bit unsigned integer; null when not IPv4. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/** Strips IPv6-mapped prefixes ("::ffff:1.2.3.4" -> "1.2.3.4"). */
function normalizeIp(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip.trim());
  return mapped?.[1] ?? ip.trim();
}

/** True when `ip` falls inside `cidr` (e.g. "5.45.207.0/25"). */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const [network, prefixRaw] = cidr.split('/');
  if (network === undefined || prefixRaw === undefined) {
    return false;
  }
  const prefix = Number(prefixRaw);
  const ipInt = ipv4ToInt(normalizeIp(ip));
  const netInt = ipv4ToInt(normalizeIp(network));
  if (ipInt === null || netInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }
  if (prefix === 0) {
    return true;
  }
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

/** True when `ip` is allowed by at least one CIDR of the allowlist. */
export function isIpAllowed(ip: string, allowlist: readonly string[]): boolean {
  const normalized = normalizeIp(ip);
  return allowlist.some((cidr) => isIpInCidr(normalized, cidr));
}

/**
 * Extracts the caller IP behind proxies/tunnels: the cloudflare tunnel sets
 * CF-Connecting-IP; generic proxies chain X-Forwarded-For (client first);
 * a direct connection exposes socket.remoteAddress.
 */
export function extractClientIp(request: {
  headers: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}): string | null {
  const headerValue = (name: string): string[] => {
    const raw = request.headers[name];
    if (typeof raw === 'string') {
      return raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
    }
    if (Array.isArray(raw)) {
      return raw.filter((entry): entry is string => typeof entry === 'string');
    }
    return [];
  };
  const cf = headerValue('cf-connecting-ip')[0];
  if (cf !== undefined) {
    return cf;
  }
  const forwarded = headerValue('x-forwarded-for')[0];
  if (forwarded !== undefined) {
    return forwarded;
  }
  return request.socket?.remoteAddress ?? null;
}
