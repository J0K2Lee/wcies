import { describe, expect, it } from 'vitest';
import { preserveEnrichedAttributes } from './listing.service';

/**
 * Pure-policy unit tests for the listing-sync variant raw_data refresh: the
 * walk rebuilds raw_data from the platform DTO, and a routine sync must not
 * silently wipe payloads written after it (OZON enrichment's
 * product_attributes = the onboarding prefill data source).
 */
describe('preserveEnrichedAttributes (listing-sync variant refresh)', () => {
  it('keeps an existing product_attributes the fresh payload lacks (OZON enrichment)', () => {
    const incoming = { marketSku: 1, offer: 'A' };
    expect(preserveEnrichedAttributes({ product_attributes: { weight: 1 } }, incoming)).toEqual({
      marketSku: 1,
      offer: 'A',
      product_attributes: { weight: 1 },
    });
  });

  it('lets the incoming payload win when it carries its own product_attributes (WB/Yandex)', () => {
    const incoming = { product_attributes: { weight: 2 } };
    expect(preserveEnrichedAttributes({ product_attributes: { weight: 1 } }, incoming)).toBe(
      incoming,
    );
  });

  it('returns the incoming payload untouched when nothing needs preserving', () => {
    const incoming = { marketSku: 1 };
    expect(preserveEnrichedAttributes(null, incoming)).toBe(incoming);
    expect(preserveEnrichedAttributes({}, incoming)).toBe(incoming);
    expect(preserveEnrichedAttributes({ other: 1 }, incoming)).toBe(incoming);
  });
});
