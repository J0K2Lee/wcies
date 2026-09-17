import { PlatformMalformedResponseError } from '../platform-error';

/** Pure parser: primary_image[0], then images[0]; no HTTP or downloads. */
export function mapProductImages(response: unknown, storeId: string): Map<string, string | null> {
  const badResponse = () =>
    new PlatformMalformedResponseError({
      storeId,
      endpoint: '/v3/product/info/list',
      httpStatus: null,
      requestId: null,
      message: 'Invalid product image response or ambiguous SKU',
    });
  if (!isRecord(response) || !Array.isArray(response['items'])) throw badResponse();
  const result = new Map<string, string | null>();
  for (const item of response['items'] as unknown[]) {
    if (!isRecord(item) || !Number.isSafeInteger(item['sku']) || Number(item['sku']) <= 0) {
      throw badResponse();
    }
    const sku = String(item['sku']);
    if (result.has(sku)) throw badResponse();
    result.set(sku, firstUrl(item['primary_image']) ?? firstUrl(item['images']));
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstUrl(value: unknown): string | null {
  if (!Array.isArray(value) || typeof value[0] !== 'string') return null;
  const text = value[0].trim();
  try {
    const url = new URL(text);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? text
      : null;
  } catch {
    return null;
  }
}
